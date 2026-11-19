import { robotsAllows, USER_AGENT } from "../lib/robots";
import type { RawJob } from "../lib/types";

/**
 * Phenom People careers sites (PwC UK, and many large employers). The public
 * search page is server-rendered and embeds its result set in `phApp.ddo`,
 * which is the same payload the page itself renders. We read that, rather than
 * hitting per-job pages, and store only the teaser text.
 */
export interface PhenomCompany {
  name: string;
  /** Origin, e.g. "https://jobs.pwc.co.uk" */
  base: string;
  /** Locale path, e.g. "/uk/en" */
  path: string;
  searchTerms: string[];
  /** Defaults to 100. */
  maxJobs?: number;
}

interface PhenomJob {
  jobId?: string;
  title?: string;
  city?: string;
  country?: string;
  cityStateCountry?: string;
  location?: string;
  postedDate?: string;
  minimumSalary?: string | number;
  maximumSalary?: string | number;
  type?: string;
  applyUrl?: string;
  descriptionTeaser?: string;
  workplaceType?: string;
  category?: string;
}

interface PhenomDdo {
  eagerLoadRefineSearch?: {
    data?: {
      jobs?: PhenomJob[];
      totalCount?: number;
    };
  };
}

const DELAY_MS = 1_500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Extracts the balanced JSON object assigned to `phApp.ddo`. */
export function extractDdo(html: string): PhenomDdo | null {
  const marker = html.indexOf("phApp.ddo = ");
  if (marker < 0) return null;

  const start = html.indexOf("{", marker);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i += 1) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as PhenomDdo;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function toIso(value: string | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export async function fetchPhenom(company: PhenomCompany): Promise<RawJob[]> {
  const host = new URL(company.base).host;
  const searchPath = `${company.path}/search-results`;

  const allowed = await robotsAllows(host, searchPath);
  if (!allowed) {
    console.warn(`[phenom] ${company.name}: robots.txt disallows ${searchPath} — skipped`);
    return [];
  }

  const maxJobs = company.maxJobs ?? 100;
  const byId = new Map<string, RawJob>();

  for (const term of company.searchTerms) {
    if (byId.size >= maxJobs) break;

    const url = `${company.base}${searchPath}?keywords=${encodeURIComponent(term)}`;
    let html: string;
    try {
      const res = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) {
        console.warn(`[phenom] ${company.name}: "${term}" -> HTTP ${res.status}`);
        continue;
      }
      html = await res.text();
    } catch (error) {
      console.warn(`[phenom] ${company.name}: "${term}" failed: ${(error as Error).message}`);
      continue;
    }

    const ddo = extractDdo(html);
    const jobs = ddo?.eagerLoadRefineSearch?.data?.jobs ?? [];
    if (jobs.length === 0) {
      console.warn(`[phenom] ${company.name}: "${term}" returned no embedded jobs`);
      continue;
    }

    for (const job of jobs) {
      if (byId.size >= maxJobs) break;
      const id = job.jobId;
      if (!id) continue;

      const location =
        job.cityStateCountry ?? job.location ?? job.city ?? job.country ?? null;
      const isUk = /united kingdom|england|scotland|wales|northern ireland/i.test(
        `${location ?? ""}`,
      );

      byId.set(`phenom:${host}:${id}`, {
        id: `phenom:${host}:${id}`,
        source: "phenom",
        title: job.title ?? "Untitled role",
        companyName: company.name,
        location,
        // Teaser only: enough to classify sponsorship language, without
        // republishing the employer's full ad text.
        description: job.descriptionTeaser ?? null,
        url: job.applyUrl ?? `${company.base}${company.path}/job/${id}`,
        salaryMin: toNumber(job.minimumSalary),
        salaryMax: toNumber(job.maximumSalary),
        salaryCurrency: isUk ? "GBP" : null,
        contractType: job.type ?? null,
        remote: /remote/i.test(`${job.workplaceType ?? ""} ${location ?? ""}`),
        postedAt: toIso(job.postedDate),
      });
    }

    await sleep(DELAY_MS);
  }

  return [...byId.values()];
}
