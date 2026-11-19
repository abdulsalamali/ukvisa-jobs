import { stripHtml } from "../lib/normalise";
import type { RawJob } from "../lib/types";

/**
 * Adzuna and Reed both offer free keys to individuals.
 * Adzuna's free tier is rate limited, so keep the query list short.
 */

export const ADZUNA_QUERIES = ["graduate", "internship", "entry level", "trainee"];

interface AdzunaResult {
  id: string;
  title: string;
  created?: string;
  redirect_url: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  description?: string;
  salary_min?: number;
  salary_max?: number;
  contract_time?: string;
}

export async function fetchAdzuna(): Promise<RawJob[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    console.warn("[adzuna] skipped — ADZUNA_APP_ID / ADZUNA_APP_KEY not set");
    return [];
  }

  const jobs: RawJob[] = [];
  for (const query of ADZUNA_QUERIES) {
    const url = new URL("https://api.adzuna.com/v1/api/jobs/gb/search/1");
    url.searchParams.set("app_id", appId);
    url.searchParams.set("app_key", appKey);
    url.searchParams.set("results_per_page", "50");
    url.searchParams.set("what", query);
    url.searchParams.set("sort_by", "date");
    url.searchParams.set("content-type", "application/json");

    try {
      const res = await fetch(url, {
        headers: { "user-agent": "ukvisa-jobs/0.1 (personal job board)" },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(
          `[adzuna] "${query}" -> HTTP ${res.status}${
            body ? `: ${body.slice(0, 160)}` : ""
          }`,
        );
        continue;
      }
      const data = (await res.json()) as { results?: AdzunaResult[] };
      for (const r of data.results ?? []) {
        const company = r.company?.display_name?.trim();
        if (!company || !r.redirect_url) continue;
        jobs.push({
          id: `adzuna:${r.id}`,
          source: "adzuna",
          title: r.title,
          companyName: company,
          location: r.location?.display_name ?? null,
          description: stripHtml(r.description),
          url: r.redirect_url,
          salaryMin: r.salary_min ?? null,
          salaryMax: r.salary_max ?? null,
          salaryCurrency: "GBP",
          contractType: r.contract_time ?? null,
          remote: /\bremote\b/i.test(`${r.title} ${r.location?.display_name ?? ""}`),
          postedAt: r.created ?? null,
        });
      }
    } catch (error) {
      console.warn(`[adzuna] "${query}" failed:`, (error as Error).message);
    }
  }
  return jobs;
}

interface ReedResult {
  jobId: number;
  employerName?: string;
  jobTitle: string;
  locationName?: string;
  jobDescription?: string;
  jobUrl: string;
  date?: string;
  minimumSalary?: number;
  maximumSalary?: number;
}

export async function fetchReed(): Promise<RawJob[]> {
  const key = process.env.REED_API_KEY;
  if (!key) {
    console.warn("[reed] skipped — REED_API_KEY not set");
    return [];
  }

  const jobs: RawJob[] = [];
  const queries = ["graduate", "internship", "entry level"];

  for (const keywords of queries) {
    const url = new URL("https://www.reed.co.uk/api/1.0/search");
    url.searchParams.set("keywords", keywords);
    url.searchParams.set("resultsToTake", "100");

    try {
      const res = await fetch(url, {
        headers: {
          authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
          "user-agent": "ukvisa-jobs/0.1 (personal job board)",
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(
          `[reed] "${keywords}" -> HTTP ${res.status}${
            body ? `: ${body.slice(0, 160)}` : ""
          }`,
        );
        continue;
      }
      const data = (await res.json()) as { results?: ReedResult[] };
      for (const r of data.results ?? []) {
        const company = r.employerName?.trim();
        if (!company || !r.jobUrl) continue;
        jobs.push({
          id: `reed:${r.jobId}`,
          source: "reed",
          title: r.jobTitle,
          companyName: company,
          location: r.locationName ?? null,
          description: stripHtml(r.jobDescription),
          url: r.jobUrl,
          salaryMin: r.minimumSalary ?? null,
          salaryMax: r.maximumSalary ?? null,
          salaryCurrency: "GBP",
          contractType: null,
          remote: /\bremote\b/i.test(`${r.jobTitle} ${r.locationName ?? ""}`),
          postedAt: r.date ?? null,
        });
      }
    } catch (error) {
      console.warn(`[reed] "${keywords}" failed:`, (error as Error).message);
    }
  }
  return jobs;
}
