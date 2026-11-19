import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { databaseUrl } from "../lib/db";
import { looksUk, normaliseOrg, tradingName } from "../lib/normalise";
import { USER_AGENT } from "../lib/robots";
import { fetchAts, type AtsCompany, type AtsKind } from "../sources/ats";

/**
 * Finds employer job boards by guessing slugs against public ATS endpoints.
 *
 * Slug guessing produces false positives: the slug "abc" belongs to some
 * unrelated company, and "elastic" belongs to Elastic NV rather than
 * "Elastic Path Software". A wrong match is worse than a miss, because the
 * ingest would attribute those jobs to a sponsor that does not employ them.
 * So a board is only accepted when the provider reports a company name that
 * matches the register entry. Providers that expose no name only accept an
 * exact full-name slug.
 */

const DEFAULT_SECTORS = [
  "tech",
  "software",
  "digital",
  "data",
  "cyber",
  "security",
  "cloud",
  "systems",
  "consult",
  "capital",
  "bank",
  "payment",
  "fintech",
  "insur",
  "labs",
  "analytic",
  "engineer",
];

interface ProbeResult {
  ok: boolean;
  jobs: number;
  /** Company name reported by the provider, when it exposes one. */
  displayName: string | null;
}

interface Provider {
  kind: AtsKind;
  url: (slug: string) => string;
  /** Reads a job count, and a company name if the response carries one. */
  parse: (json: unknown) => { jobs: number; displayName: string | null };
  /** Optional follow-up that fetches the board's display name. */
  nameUrl?: (slug: string) => string;
  nameFromJson?: (json: unknown) => string | null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const countArray = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const PROVIDERS: Provider[] = [
  {
    kind: "greenhouse",
    url: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    parse: (json) => ({ jobs: countArray(asRecord(json).jobs), displayName: null }),
    nameUrl: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}`,
    nameFromJson: (json) => {
      const name = asRecord(json).name;
      return typeof name === "string" ? name : null;
    },
  },
  {
    kind: "lever",
    url: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
    parse: (json) => ({ jobs: countArray(json), displayName: null }),
  },
  {
    kind: "ashby",
    url: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    parse: (json) => ({ jobs: countArray(asRecord(json).jobs), displayName: null }),
  },
  {
    kind: "workable",
    url: (slug) => `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`,
    parse: (json) => {
      const record = asRecord(json);
      const name = record.name;
      return {
        jobs: countArray(record.jobs),
        displayName: typeof name === "string" ? name : null,
      };
    },
  },
  {
    kind: "smartrecruiters",
    url: (slug) => `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`,
    parse: (json) => {
      const record = asRecord(json);
      const first = Array.isArray(record.content) ? asRecord(record.content[0]) : {};
      const company = asRecord(first.company);
      return {
        jobs: Number(record.totalFound ?? countArray(record.content)),
        displayName: typeof company.name === "string" ? company.name : null,
      };
    },
  },
];

/** Words that are usually dropped from a slug but rarely from a legal name. */
const GENERIC_TAIL =
  /(?:\s+(?:bank|group|holdings|holding|services|solutions|technologies|technology|consulting|consultancy|systems|partners|labs|limited|ltd|plc|uk|gb|com))+$/;

function candidates(orgName: string): { strict: boolean; slug: string }[] {
  const norm = normaliseOrg(orgName);
  if (!norm) return [];

  const stripped = norm.replace(GENERIC_TAIL, "").trim() || norm;
  const trading = tradingName(orgName);

  const seen = new Map<string, { strict: boolean; slug: string }>();
  const add = (value: string, strict: boolean) => {
    const compact = value.replace(/[^a-z0-9]/g, "");
    const hyphen = value.replace(/\s+/g, "-");
    for (const slug of [compact, hyphen]) {
      if (/^[a-z0-9][a-z0-9-]{2,38}$/.test(slug) && !seen.has(slug)) {
        seen.set(slug, { strict, slug });
      }
    }
  };

  // Full legal name: safe even without a display name to compare against.
  add(norm, true);
  if (trading) add(trading, true);
  // Trailing generic words removed: only accepted with name verification.
  add(stripped, false);

  return [...seen.values()].slice(0, 6);
}

function namesMatch(providerName: string, registerName: string): boolean {
  const a = normaliseOrg(providerName).split(" ").filter(Boolean);
  const b = normaliseOrg(registerName).split(" ").filter(Boolean);
  if (a.length === 0 || b.length === 0) return false;
  if (a.join(" ") === b.join(" ")) return true;

  const setB = new Set(b);
  const overlap = a.filter((token) => setB.has(token)).length;
  // "Monzo" vs "Monzo Bank" passes; "Elastic" vs "Elastic Path Software" does not.
  return overlap / Math.max(a.length, b.length) >= 0.5;
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

async function probe(provider: Provider, slug: string): Promise<ProbeResult> {
  const json = await getJson(provider.url(slug));
  if (json === null) return { ok: false, jobs: 0, displayName: null };

  const parsed = provider.parse(json);
  if (parsed.jobs === 0) return { ok: false, jobs: 0, displayName: parsed.displayName };

  let displayName = parsed.displayName;
  if (!displayName && provider.nameUrl && provider.nameFromJson) {
    const meta = await getJson(provider.nameUrl(slug));
    if (meta !== null) displayName = provider.nameFromJson(meta);
  }

  return { ok: true, jobs: parsed.jobs, displayName };
}

async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

interface Hit {
  kind: AtsKind;
  slug: string;
  name: string;
  jobs: number;
  ukJobs: number;
  providerName: string | null;
  verifiedBy: "name" | "exact-slug";
}

/**
 * Final gate. A board is only useful if it advertises UK roles, and this also
 * filters out same-named companies in other countries (INFUSE in Singapore,
 * for example, versus a UK consultancy of the same name).
 */
async function countUkJobs(kind: AtsKind, slug: string, name: string): Promise<number> {
  const company: AtsCompany = { kind, slug, name };
  const jobs = await fetchAts(company);
  return jobs.filter((job) => looksUk(job.location)).length;
}

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

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  loadEnv();

  const limit = Number(arg("limit") ?? 100);
  const concurrency = Number(arg("concurrency") ?? 5);
  const query = arg("query");
  const city = arg("city");
  const merge = process.argv.includes("--merge");

  const client = createClient({
    url: databaseUrl(),
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });

  const where: string[] = [];
  const args: (string | number)[] = [];

  if (query) {
    where.push("s.org_name LIKE ?");
    args.push(`%${query}%`);
  } else if (!city) {
    where.push(`(${DEFAULT_SECTORS.map(() => "s.org_norm LIKE ?").join(" OR ")})`);
    for (const sector of DEFAULT_SECTORS) args.push(`%${sector}%`);
  }

  if (city) {
    where.push("s.org_norm IN (SELECT r.org_norm FROM sponsor_rows r WHERE r.town LIKE ?)");
    args.push(`%${city}%`);
  }

  const sql = `SELECT s.org_name FROM sponsors s
               ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY s.town_count DESC
               LIMIT ?`;
  args.push(limit);

  const result = await client.execute({ sql, args });
  const orgs = result.rows.map((row) => String(row.org_name));

  console.log(
    `Probing ${orgs.length} sponsors (concurrency ${concurrency}). ` +
      `Only boards whose company name matches the register are kept.`,
  );

  const hits: Hit[] = [];
  let rejected = 0;
  let noUk = 0;

  const accept = async (
    kind: AtsKind,
    slug: string,
    name: string,
    jobs: number,
    providerName: string | null,
    verifiedBy: "name" | "exact-slug",
  ): Promise<boolean> => {
    const ukJobs = await countUkJobs(kind, slug, name);
    if (ukJobs === 0) {
      noUk += 1;
      return false;
    }
    hits.push({ kind, slug, name, jobs, ukJobs, providerName, verifiedBy });
    return true;
  };

  await pool(orgs, concurrency, async (orgName) => {
    for (const candidate of candidates(orgName)) {
      for (const provider of PROVIDERS) {
        const outcome = await probe(provider, candidate.slug);
        if (!outcome.ok) continue;

        // No display name: only trust an exact full-name slug.
        if (!outcome.displayName) {
          if (candidate.strict) {
            if (
              await accept(
                provider.kind,
                candidate.slug,
                orgName,
                outcome.jobs,
                null,
                "exact-slug",
              )
            ) {
              return;
            }
            continue;
          }
          rejected += 1;
          continue;
        }

        if (namesMatch(outcome.displayName, orgName)) {
          if (
            await accept(
              provider.kind,
              candidate.slug,
              orgName,
              outcome.jobs,
              outcome.displayName,
              "name",
            )
          ) {
            return;
          }
          continue;
        }

        // Slug exists but belongs to someone else; keep looking.
        rejected += 1;
      }
    }
  });

  hits.sort((a, b) => b.jobs - a.jobs);

  console.log(
    `\n${hits.length} verified UK boards from ${orgs.length} sponsors ` +
      `(${rejected} slug collisions, ${noUk} same-name boards with no UK roles).\n`,
  );

  for (const hit of hits) {
    const label = hit.providerName ? `${hit.name} ← ${hit.providerName}` : hit.name;
    console.log(
      `  ${String(hit.ukJobs).padStart(4)} UK / ${String(hit.jobs).padStart(4)}  ` +
        `${hit.kind.padEnd(15)} ${hit.slug.padEnd(22)} ${label}`,
    );
  }

  const outFile = path.join(process.cwd(), "config/ats-discovered.json");
  writeFileSync(outFile, `${JSON.stringify(hits, null, 2)}\n`);
  console.log(`\nWritten to ${outFile}`);

  if (merge) {
    const targetFile = path.join(process.cwd(), "config/ats-companies.json");
    const existing: AtsCompany[] = JSON.parse(readFileSync(targetFile, "utf8"));
    const known = new Set(existing.map((company) => `${company.kind}:${company.slug}`));

    let added = 0;
    for (const hit of hits) {
      const key = `${hit.kind}:${hit.slug}`;
      if (known.has(key)) continue;
      existing.push({ kind: hit.kind, slug: hit.slug, name: hit.name });
      known.add(key);
      added += 1;
    }
    writeFileSync(targetFile, `${JSON.stringify(existing, null, 2)}\n`);
    console.log(`Merged ${added} new boards into ${targetFile}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
