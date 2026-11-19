import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db } from "../lib/db";
import { listJobs, type JobListItem } from "../lib/queries";

/**
 * Static export has no server, so the pages read pre-generated JSON instead.
 * Run before `next build`.
 */

interface SponsorRow {
  slug: string;
  name: string;
  rating: string | null;
  towns: string[];
  routes: string[];
  townCount: number;
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value ?? "")) as T;
  } catch {
    return fallback;
  }
}

async function exportJobs(): Promise<JobListItem[]> {
  const pageSize = 100;
  const all: JobListItem[] = [];

  for (let page = 1; page < 200; page += 1) {
    const { items, total } = await listJobs({ sort: "relevance", page, pageSize });
    all.push(...items);
    if (all.length >= total || items.length === 0) break;
  }

  // The relevance reasons quote keywords taken from the CV. Keep the signal,
  // drop the words: the deployed JSON is public.
  return all.map((job) => ({
    ...job,
    relevanceSignals: job.relevanceSignals.map((signal) =>
      signal.startsWith("Overlaps your CV:")
        ? "Overlaps wording from your CV"
        : signal,
    ),
  }));
}

async function exportSponsors(): Promise<{ total: number; shards: Record<string, number> }> {
  const res = await db().execute(
    "SELECT slug, org_name, towns, routes, rating, town_count FROM sponsors ORDER BY org_name COLLATE NOCASE",
  );

  const shards = new Map<string, SponsorRow[]>();
  for (const row of res.rows) {
    const sponsor: SponsorRow = {
      slug: String(row.slug),
      name: String(row.org_name),
      rating: row.rating ? String(row.rating) : null,
      towns: parseJson<string[]>(row.towns, []),
      routes: parseJson<string[]>(row.routes, []),
      townCount: Number(row.town_count ?? 0),
    };

    const first = sponsor.name.trim()[0]?.toLowerCase() ?? "";
    const key = /[a-z]/.test(first) ? first : "other";
    const bucket = shards.get(key) ?? [];
    bucket.push(sponsor);
    shards.set(key, bucket);
  }

  const counts: Record<string, number> = {};
  for (const [key, rows] of shards) {
    writeFileSync(
      path.join(process.cwd(), "public/data", `sponsors-${key}.json`),
      JSON.stringify(rows),
    );
    counts[key] = rows.length;
  }

  return { total: res.rows.length, shards: counts };
}

async function main(): Promise<void> {
  mkdirSync(path.join(process.cwd(), "public/data"), { recursive: true });

  const jobs = await exportJobs();
  writeFileSync(
    path.join(process.cwd(), "public/data/jobs.json"),
    JSON.stringify(jobs),
  );
  console.log(`[export] ${jobs.length} jobs`);

  const sponsors = await exportSponsors();
  writeFileSync(
    path.join(process.cwd(), "public/data/sponsors-index.json"),
    JSON.stringify(sponsors),
  );
  console.log(`[export] ${sponsors.total} sponsors across ${Object.keys(sponsors.shards).length} shards`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
