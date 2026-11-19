import { db } from "./db";
import type {
  Confidence,
  JobCategory,
  JobFlag,
  JobType,
  Signal,
} from "./types";

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

export interface JobListItem {
  id: string;
  source: string;
  title: string;
  companyName: string;
  sponsorSlug: string | null;
  location: string | null;
  city: string | null;
  url: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  jobType: JobType;
  jobCategory: JobCategory;
  confidence: Confidence;
  flags: JobFlag[];
  signals: Signal[];
  relevance: number;
  relevanceSignals: string[];
  postedAt: string | null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value ?? "")) as T;
  } catch {
    return fallback;
  }
}

function toJob(row: Record<string, unknown>): JobListItem {
  return {
    id: String(row.id),
    source: String(row.source),
    title: String(row.title),
    companyName: String(row.company_name),
    sponsorSlug: row.sponsor_slug ? String(row.sponsor_slug) : null,
    location: row.location ? String(row.location) : null,
    city: row.city ? String(row.city) : null,
    url: String(row.url),
    salaryMin: row.salary_min === null ? null : Number(row.salary_min),
    salaryMax: row.salary_max === null ? null : Number(row.salary_max),
    salaryCurrency: row.salary_currency ? String(row.salary_currency) : null,
    jobType: String(row.job_type) as JobType,
    jobCategory: String(row.job_category) as JobCategory,
    confidence: String(row.confidence) as Confidence,
    flags: parseJson<JobFlag[]>(row.flags, []),
    signals: parseJson<Signal[]>(row.signals, []),
    relevance: Number(row.relevance ?? 0),
    relevanceSignals: parseJson<string[]>(row.relevance_signals, []),
    postedAt: row.posted_at ? String(row.posted_at) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export type SortKey = "relevance" | "newest" | "salary";

export interface JobFilters {
  q?: string;
  city?: string;
  types?: JobType[];
  category?: JobCategory;
  confidence?: Confidence[];
  minRelevance?: number;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
}

const ORDER_BY: Record<SortKey, string> = {
  relevance: "relevance DESC, posted_at DESC",
  newest: "posted_at DESC, relevance DESC",
  salary: "COALESCE(salary_max, salary_min) DESC, relevance DESC",
};

export async function listJobs(filters: JobFilters): Promise<{
  items: JobListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const where: string[] = ["active = 1"];
  const args: (string | number)[] = [];

  if (filters.q) {
    where.push("(title LIKE ? OR company_name LIKE ?)");
    const like = `%${filters.q}%`;
    args.push(like, like);
  }
  if (filters.city) {
    where.push("city = ?");
    args.push(filters.city);
  }
  if (filters.types?.length) {
    where.push(`job_type IN (${filters.types.map(() => "?").join(",")})`);
    args.push(...filters.types);
  }
  if (filters.category) {
    where.push("job_category = ?");
    args.push(filters.category);
  }
  if (filters.confidence?.length) {
    where.push(`confidence IN (${filters.confidence.map(() => "?").join(",")})`);
    args.push(...filters.confidence);
  }
  if (filters.minRelevance) {
    where.push("relevance >= ?");
    args.push(filters.minRelevance);
  }

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(6, filters.pageSize ?? 24));
  const order = ORDER_BY[filters.sort ?? "relevance"];
  const whereSql = where.join(" AND ");

  const [rows, count] = await Promise.all([
    db().execute({
      sql: `SELECT * FROM jobs WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
      args: [...args, pageSize, (page - 1) * pageSize],
    }),
    db().execute({
      sql: `SELECT COUNT(*) AS n FROM jobs WHERE ${whereSql}`,
      args,
    }),
  ]);

  return {
    items: rows.rows.map((row) => toJob(row as Record<string, unknown>)),
    total: Number(count.rows[0]?.n ?? 0),
    page,
    pageSize,
  };
}

export async function getJob(id: string): Promise<JobListItem | null> {
  const res = await db().execute({ sql: "SELECT * FROM jobs WHERE id = ?", args: [id] });
  const row = res.rows[0];
  return row ? toJob(row as Record<string, unknown>) : null;
}

/* ------------------------------------------------------------------ */
/* Sponsors                                                            */
/* ------------------------------------------------------------------ */

export interface SponsorListItem {
  slug: string;
  orgName: string;
  towns: string[];
  routes: string[];
  rating: string | null;
  townCount: number;
}

function toSponsor(row: Record<string, unknown>): SponsorListItem {
  return {
    slug: String(row.slug),
    orgName: String(row.org_name),
    towns: parseJson<string[]>(row.towns, []),
    routes: parseJson<string[]>(row.routes, []),
    rating: row.rating ? String(row.rating) : null,
    townCount: Number(row.town_count ?? 0),
  };
}

export async function listSponsors(opts: {
  q?: string;
  city?: string;
  route?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: SponsorListItem[]; total: number; page: number; pageSize: number }> {
  // The register stores one row per town, so filter on the rows table and
  // return the aggregated sponsor row.
  const where: string[] = ["1 = 1"];
  const args: (string | number)[] = [];

  if (opts.q) {
    where.push("r.org_name LIKE ?");
    args.push(`%${opts.q}%`);
  }
  if (opts.city) {
    where.push("r.town LIKE ?");
    args.push(`%${opts.city}%`);
  }
  if (opts.route) {
    where.push("r.route = ?");
    args.push(opts.route);
  }

  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, opts.pageSize ?? 40));

  const [rows, count] = await Promise.all([
    db().execute({
      sql: `SELECT s.* FROM sponsors s
            WHERE s.org_norm IN (SELECT DISTINCT r.org_norm FROM sponsor_rows r WHERE ${where.join(" AND ")})
            ORDER BY s.org_name COLLATE NOCASE
            LIMIT ? OFFSET ?`,
      args: [...args, pageSize, (page - 1) * pageSize],
    }),
    db().execute({
      sql: `SELECT COUNT(DISTINCT r.org_norm) AS n FROM sponsor_rows r WHERE ${where.join(" AND ")}`,
      args,
    }),
  ]);

  return {
    items: rows.rows.map((row) => toSponsor(row as Record<string, unknown>)),
    total: Number(count.rows[0]?.n ?? 0),
    page,
    pageSize,
  };
}

export async function getSponsor(slug: string): Promise<SponsorListItem | null> {
  const res = await db().execute({ sql: "SELECT * FROM sponsors WHERE slug = ?", args: [slug] });
  const row = res.rows[0];
  return row ? toSponsor(row as Record<string, unknown>) : null;
}

export async function getSponsorJobs(slug: string): Promise<JobListItem[]> {
  const res = await db().execute({
    sql: "SELECT * FROM jobs WHERE sponsor_slug = ? AND active = 1 ORDER BY relevance DESC, posted_at DESC LIMIT 50",
    args: [slug],
  });
  return res.rows.map((row) => toJob(row as Record<string, unknown>));
}

/* ------------------------------------------------------------------ */
/* Aggregates                                                          */
/* ------------------------------------------------------------------ */

export interface SiteStats {
  sponsors: number;
  jobs: number;
  jobsThisWeek: number;
  confidence: Record<Confidence, number>;
  sourceDate: string | null;
  updatedAt: string | null;
}

export async function getStats(): Promise<SiteStats> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [counts, byConfidence, meta] = await Promise.all([
    db().execute({
      sql: `SELECT
              (SELECT COUNT(*) FROM sponsors) AS sponsors,
              (SELECT COUNT(*) FROM jobs WHERE active = 1) AS jobs,
              (SELECT COUNT(*) FROM jobs WHERE active = 1 AND posted_at >= ?) AS jobs_week`,
      args: [weekAgo],
    }),
    db().execute(
      "SELECT confidence, COUNT(*) AS n FROM jobs WHERE active = 1 GROUP BY confidence",
    ),
    db().execute("SELECT key, value FROM meta"),
  ]);

  const metaMap = new Map(meta.rows.map((row) => [String(row.key), String(row.value)]));
  const confidence: Record<Confidence, number> = {
    apply_with_confidence: 0,
    application_recommended: 0,
    unverified: 0,
    no_sponsorship: 0,
  };
  for (const row of byConfidence.rows) {
    confidence[String(row.confidence) as Confidence] = Number(row.n);
  }

  const first = counts.rows[0];
  return {
    sponsors: Number(first?.sponsors ?? 0),
    jobs: Number(first?.jobs ?? 0),
    jobsThisWeek: Number(first?.jobs_week ?? 0),
    confidence,
    sourceDate: metaMap.get("sponsors_source_date") ?? null,
    updatedAt: metaMap.get("jobs_updated_at") ?? null,
  };
}

export interface CityCount {
  city: string;
  jobs: number;
}

export async function getTopCities(limit = 8): Promise<CityCount[]> {
  const res = await db().execute({
    sql: `SELECT city, COUNT(*) AS n FROM jobs
          WHERE active = 1 AND city IS NOT NULL
          GROUP BY city ORDER BY n DESC LIMIT ?`,
    args: [limit],
  });
  return res.rows.map((row) => ({ city: String(row.city), jobs: Number(row.n) }));
}

export async function getTypeCounts(): Promise<Record<string, number>> {
  const res = await db().execute(
    "SELECT job_type, COUNT(*) AS n FROM jobs WHERE active = 1 GROUP BY job_type",
  );
  const counts: Record<string, number> = {};
  for (const row of res.rows) counts[String(row.job_type)] = Number(row.n);
  return counts;
}

export async function getRoutes(): Promise<string[]> {
  const res = await db().execute(
    "SELECT DISTINCT route FROM sponsor_rows WHERE route IS NOT NULL ORDER BY route",
  );
  return res.rows.map((row) => String(row.route));
}
