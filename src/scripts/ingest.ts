import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type Client, type InArgs, type InValue } from "@libsql/client";
import { databaseUrl, migrate, setMeta } from "../lib/db";
import { compactOrg, deriveCity, looksUk, normaliseOrg, tradingName } from "../lib/normalise";
import { assess } from "../lib/classify";
import { loadCvKeywords, loadProfile, scoreRelevance } from "../lib/relevance";
import type { RawJob, SponsorRef } from "../lib/types";
import { downloadRegister, parseRegister } from "../sources/sponsors";
import { fetchAts, type AtsCompany } from "../sources/ats";
import { fetchAdzuna, fetchReed } from "../sources/aggregators";

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function loadEnv(): void {
  const file = path.join(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}

const STALE_AFTER_DAYS = 3;
const PRUNE_AFTER_DAYS = 60;
const MAX_DESCRIPTION = 20_000;
const MAX_PARAMS = 900;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Minimal interface so this works against both a Client and a Transaction. */
interface Executor {
  execute(query: { sql: string; args: InArgs }): Promise<unknown>;
}

async function insertMany(
  executor: Executor,
  sqlPrefix: string,
  columns: number,
  rows: InValue[][],
  conflictClause = "",
): Promise<void> {
  const batchSize = Math.max(1, Math.floor(MAX_PARAMS / columns));
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const placeholders = chunk
      .map((_row, rowIndex) => {
        const base = rowIndex * columns;
        return `(${Array.from({ length: columns }, (_c, col) => `?${base + col + 1}`).join(",")})`;
      })
      .join(",");

    await executor.execute({
      sql: `${sqlPrefix} VALUES ${placeholders}${conflictClause}`,
      args: chunk.flat(),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Sponsor register                                                    */
/* ------------------------------------------------------------------ */

async function ingestSponsors(client: Client, csvPath?: string): Promise<number> {
  console.log("[sponsors] fetching Home Office register…");

  let csv: string;
  let sourceDate: string;
  let sourceUrl: string;

  if (csvPath) {
    csv = readFileSync(csvPath, "utf8");
    sourceDate = new Date().toISOString().slice(0, 10);
    sourceUrl = csvPath;
  } else {
    const snapshot = await downloadRegister();
    csv = snapshot.csv;
    sourceDate = snapshot.date;
    sourceUrl = snapshot.url;
  }

  const register = parseRegister(csv, sourceDate);
  console.log(
    `[sponsors] ${register.rows.length.toLocaleString()} rows → ${register.sponsors.length.toLocaleString()} organisations (register dated ${sourceDate})`,
  );

  const tx = await client.transaction("write");
  try {
    await tx.execute("DELETE FROM sponsor_rows");
    await tx.execute("DELETE FROM sponsors");

    await insertMany(
      tx,
      "INSERT INTO sponsor_rows (org_name, org_norm, town, county, rating, route, source_date)",
      7,
      register.rows.map((r) => [
        r.orgName,
        r.orgNorm,
        r.town,
        r.county,
        r.rating,
        r.route,
        sourceDate,
      ]),
    );

    await insertMany(
      tx,
      "INSERT OR REPLACE INTO sponsors (slug, org_name, org_norm, towns, routes, rating, town_count)",
      7,
      register.sponsors.map((s) => [
        s.slug,
        s.orgName,
        s.orgNorm,
        JSON.stringify(s.towns),
        JSON.stringify(s.routes),
        s.rating,
        s.townCount,
      ]),
    );

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }

  await setMeta(client, "sponsors_source_date", sourceDate);
  await setMeta(client, "sponsors_source_url", sourceUrl);
  await setMeta(client, "sponsors_updated_at", new Date().toISOString());
  await setMeta(client, "sponsors_count", String(register.sponsors.length));

  return register.sponsors.length;
}

/* ------------------------------------------------------------------ */
/* Employer matching                                                   */
/* ------------------------------------------------------------------ */

interface MatchIndex {
  byNorm: Map<string, SponsorRef>;
  byCompact: Map<string, SponsorRef>;
  byTrading: Map<string, SponsorRef>;
  aliases: Record<string, string>;
}

async function buildMatchIndex(client: Client): Promise<MatchIndex> {
  const result = await client.execute(
    "SELECT slug, org_name, org_norm, routes, rating FROM sponsors",
  );
  const byNorm = new Map<string, SponsorRef>();
  const byCompact = new Map<string, SponsorRef>();
  const byTrading = new Map<string, SponsorRef>();

  for (const row of result.rows) {
    const ref: SponsorRef = {
      slug: String(row.slug),
      orgName: String(row.org_name),
      rating: row.rating ? String(row.rating) : null,
      routes: JSON.parse(String(row.routes ?? "[]")),
    };
    byNorm.set(String(row.org_norm), ref);
    byCompact.set(compactOrg(String(row.org_norm)), ref);

    const trading = tradingName(String(row.org_name));
    if (trading && !byTrading.has(trading)) byTrading.set(trading, ref);
  }

  let aliases: Record<string, string> = {};
  const aliasFile = path.join(process.cwd(), "config/aliases.json");
  if (existsSync(aliasFile)) {
    aliases = JSON.parse(readFileSync(aliasFile, "utf8"));
  }

  console.log(`[match] indexed ${byNorm.size.toLocaleString()} sponsors`);
  return { byNorm, byCompact, byTrading, aliases };
}

function matchSponsor(company: string, index: MatchIndex): SponsorRef | null {
  const norm = normaliseOrg(company);
  if (!norm) return null;

  const aliased = index.aliases[norm];
  if (aliased) {
    const hit = index.byNorm.get(aliased);
    if (hit) return hit;
  }

  return (
    index.byNorm.get(norm) ??
    index.byCompact.get(compactOrg(norm)) ??
    index.byTrading.get(norm) ??
    null
  );
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

async function collectJobs(): Promise<RawJob[]> {
  const raw: RawJob[] = [];

  const companiesFile = path.join(process.cwd(), "config/ats-companies.json");
  const companies: AtsCompany[] = existsSync(companiesFile)
    ? JSON.parse(readFileSync(companiesFile, "utf8"))
    : [];

  console.log(`[jobs] pulling ${companies.length} employer job boards…`);
  const atsResults = await Promise.allSettled(companies.map((c) => fetchAts(c)));
  for (const result of atsResults) {
    if (result.status === "fulfilled") raw.push(...result.value);
    else console.warn("[jobs] ATS fetch failed:", result.reason);
  }

  const [adzuna, reed] = await Promise.all([fetchAdzuna(), fetchReed()]);
  raw.push(...adzuna, ...reed);

  // Keep the board UK-only. Aggregators need an explicit UK location;
  // employer boards are trusted unless they name a clearly foreign city.
  const uk = raw.filter((job) => {
    if (job.location && looksUk(job.location)) return true;
    if (job.location === null) return job.source !== "adzuna" && job.source !== "reed";
    return false;
  });

  const deduped = new Map<string, RawJob>();
  for (const job of uk) deduped.set(job.id, job);

  console.log(
    `[jobs] ${raw.length} fetched → ${deduped.size} UK postings (${raw.length - deduped.size} filtered out)`,
  );
  return [...deduped.values()];
}

async function upsertJobs(client: Client, jobs: RawJob[], index: MatchIndex): Promise<void> {
  const now = new Date().toISOString();
  const staleCutoff = daysAgo(STALE_AFTER_DAYS);

  const profile = loadProfile();
  const cvKeywords = loadCvKeywords(profile);
  console.log(
    `[match] profile: ${profile.fields.length} fields, ${profile.skills.length} skills, ${cvKeywords.length} CV keywords`,
  );

  const columns = [
    "id",
    "source",
    "title",
    "company_name",
    "company_norm",
    "sponsor_slug",
    "location",
    "city",
    "description",
    "url",
    "salary_min",
    "salary_max",
    "salary_currency",
    "contract_type",
    "remote",
    "posted_at",
    "job_type",
    "job_category",
    "confidence",
    "flags",
    "signals",
    "relevance",
    "relevance_signals",
    "first_seen",
    "last_seen",
    "active",
  ] as const;

  const rows = jobs.map((job) => {
    const sponsor = matchSponsor(job.companyName, index);
    const assessment = assess({
      title: job.title,
      description: job.description,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      sponsor,
    });
    const relevance = scoreRelevance(
      {
        title: job.title,
        description: job.description,
        location: job.location,
        jobType: assessment.jobType,
        jobCategory: assessment.jobCategory,
        confidence: assessment.confidence,
        postedAt: job.postedAt,
      },
      profile,
      cvKeywords,
    );

    return [
      job.id,
      job.source,
      job.title,
      job.companyName,
      normaliseOrg(job.companyName),
      sponsor?.slug ?? null,
      job.location,
      deriveCity(job.location),
      (job.description ?? "").slice(0, MAX_DESCRIPTION) || null,
      job.url,
      job.salaryMin,
      job.salaryMax,
      job.salaryCurrency,
      job.contractType,
      job.remote ? 1 : 0,
      job.postedAt,
      assessment.jobType,
      assessment.jobCategory,
      assessment.confidence,
      JSON.stringify(assessment.flags),
      JSON.stringify(assessment.signals),
      relevance.score,
      JSON.stringify(relevance.signals),
      now,
      now,
      1,
    ];
  });

  // Refresh everything on re-ingest, but never move first_seen.
  const conflictClause = ` ON CONFLICT(id) DO UPDATE SET ${columns
    .filter((column) => column !== "id" && column !== "first_seen")
    .map((column) => `${column} = excluded.${column}`)
    .join(", ")}`;

  const tx = await client.transaction("write");
  try {
    await insertMany(
      tx,
      `INSERT INTO jobs (${columns.join(", ")})`,
      columns.length,
      rows,
      conflictClause,
    );
    await tx.execute({
      sql: "UPDATE jobs SET active = 0 WHERE last_seen < ? AND active = 1",
      args: [staleCutoff],
    });
    await tx.execute({
      sql: "DELETE FROM jobs WHERE active = 0 AND last_seen < ?",
      args: [daysAgo(PRUNE_AFTER_DAYS)],
    });
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }

  const counts = await client.execute(
    "SELECT confidence, COUNT(*) AS n FROM jobs WHERE active = 1 GROUP BY confidence",
  );
  for (const row of counts.rows) {
    console.log(`[jobs] ${row.confidence}: ${row.n}`);
  }

  await setMeta(client, "jobs_updated_at", now);
  const total = await client.execute("SELECT COUNT(*) AS n FROM jobs WHERE active = 1");
  await setMeta(client, "jobs_count", String(Number(total.rows[0]?.n ?? 0)));
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  loadEnv();

  const args = process.argv.slice(2);
  const sponsorsOnly = args.includes("--sponsors");
  const jobsOnly = args.includes("--jobs");
  const csvFlag = args.indexOf("--csv");
  const csvPath = csvFlag >= 0 ? args[csvFlag + 1] : undefined;

  mkdirSync(path.join(process.cwd(), "data"), { recursive: true });

  const client = createClient({
    url: databaseUrl(),
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
  await migrate(client);

  if (!jobsOnly) await ingestSponsors(client, csvPath);

  if (!sponsorsOnly) {
    const index = await buildMatchIndex(client);
    const jobs = await collectJobs();
    await upsertJobs(client, jobs, index);
  }

  const summary = await client.execute(
    "SELECT (SELECT COUNT(*) FROM sponsors) AS sponsors, (SELECT COUNT(*) FROM jobs WHERE active = 1) AS jobs",
  );
  const row = summary.rows[0];
  console.log(
    `\nDone. ${Number(row?.sponsors ?? 0).toLocaleString()} sponsors, ${Number(
      row?.jobs ?? 0,
    ).toLocaleString()} live jobs → ${databaseUrl()}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
