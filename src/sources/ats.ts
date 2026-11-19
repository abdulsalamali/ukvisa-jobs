import { stripHtml } from "../lib/normalise";
import type { RawJob } from "../lib/types";

/**
 * Public job-board endpoints that employers run themselves. No key, no quota,
 * and the postings are first-party — which makes them the most reliable source
 * for a personal board.
 */

const TIMEOUT_MS = 20_000;

async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "ukvisa-jobs/0.1 (personal job board)" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type AtsKind = "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters";

export interface AtsCompany {
  kind: AtsKind;
  slug: string;
  /** Display name override when the ATS one is messy. */
  name?: string;
}

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  location?: { name?: string };
  content?: string;
  metadata?: { name: string; value: string | null }[];
}

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  categories?: { location?: string; commitment?: string; team?: string };
  descriptionPlain?: string;
  additionalPlain?: string;
  salaryRange?: { min?: number; max?: number; currency?: string };
}

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  jobUrl?: string;
  publishedAt?: string;
  descriptionHtml?: string;
  employmentType?: string;
  isRemote?: boolean;
  compensation?: {
    compensationTierSummary?: string;
    scrapeableCompensationSalarySummary?: string;
  };
}

interface WorkableJob {
  shortcode?: string;
  title?: string;
  description?: string;
  url?: string;
  created_at?: string;
  location?: { city?: string; country?: string };
}

interface SmartRecruitersJob {
  id?: string;
  name?: string;
  releasedDate?: string;
  location?: { city?: string; country?: string; remote?: boolean };
}

function cleanLocation(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const value = raw.replace(/\s+/g, " ").trim();
  return value.length ? value : null;
}

/** Single source of truth for board URLs, used by the fetchers and the checks. */
export function boardUrl(company: AtsCompany): string {
  switch (company.kind) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs?content=true`;
    case "lever":
      return `https://api.lever.co/v0/postings/${company.slug}?mode=json`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${company.slug}?includeCompensation=true`;
    case "workable":
      return `https://apply.workable.com/api/v1/widget/accounts/${company.slug}?details=true`;
    case "smartrecruiters":
      return `https://api.smartrecruiters.com/v1/companies/${company.slug}/postings?limit=100`;
  }
}

interface Salary {
  min: number | null;
  max: number | null;
  currency: string | null;
}

const NO_SALARY: Salary = { min: null, max: null, currency: null };

/** Parses strings like "£80,000 – £100,000" or "80K-100K GBP". */
function parseSalary(raw: unknown): Salary {
  if (raw === null || raw === undefined) return NO_SALARY;
  // Greenhouse metadata values are sometimes numbers, not strings.
  const text = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "";
  if (!text.trim()) return NO_SALARY;

  const currency = /£|gbp/i.test(text)
    ? "GBP"
    : /\$|usd/i.test(text)
      ? "USD"
      : /€|eur/i.test(text)
        ? "EUR"
        : null;

  const values: number[] = [];
  for (const match of text.matchAll(/(\d[\d,.]*)\s*(k|m)?\b/gi)) {
    let value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const suffix = (match[2] ?? "").toLowerCase();
    if (suffix === "k") value *= 1_000;
    if (suffix === "m") value *= 1_000_000;
    // Ignore stray small numbers like "3 years" or percentages.
    if (value >= 1000 && value <= 1_000_000) values.push(value);
  }

  if (values.length === 0) return { min: null, max: null, currency };
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    currency,
  };
}

export async function fetchGreenhouse(company: AtsCompany): Promise<RawJob[]> {
  const data = await getJson<{ jobs?: GreenhouseJob[] }>(boardUrl(company));
  return (data?.jobs ?? []).map((job) => {
    const salaryMeta = (job.metadata ?? []).find((entry) =>
      /salary|compensation|pay range/i.test(entry.name),
    );
    const salary = parseSalary(salaryMeta?.value);
    return {
      id: `greenhouse:${company.slug}:${job.id}`,
      source: "greenhouse",
      title: job.title,
      companyName: company.name ?? company.slug,
      location: cleanLocation(job.location?.name),
      description: stripHtml(job.content),
      url: job.absolute_url,
      salaryMin: salary.min,
      salaryMax: salary.max,
      salaryCurrency: salary.currency,
      contractType: null,
      remote: /\bremote\b/i.test(job.location?.name ?? ""),
      postedAt: job.updated_at ?? null,
    };
  });
}

export async function fetchLever(company: AtsCompany): Promise<RawJob[]> {
  const data = await getJson<LeverJob[]>(boardUrl(company));
  return (data ?? []).map((job) => ({
    id: `lever:${company.slug}:${job.id}`,
    source: "lever",
    title: job.text,
    companyName: company.name ?? company.slug,
    location: cleanLocation(job.categories?.location),
    description: [job.descriptionPlain, job.additionalPlain].filter(Boolean).join("\n\n"),
    url: job.hostedUrl,
    salaryMin: job.salaryRange?.min ?? null,
    salaryMax: job.salaryRange?.max ?? null,
    salaryCurrency: job.salaryRange?.currency ?? null,
    contractType: job.categories?.commitment ?? null,
    remote: /\bremote\b/i.test(job.categories?.location ?? ""),
    postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
  }));
}

export async function fetchAshby(company: AtsCompany): Promise<RawJob[]> {
  const data = await getJson<{ jobs?: AshbyJob[] }>(boardUrl(company));
  return (data?.jobs ?? []).map((job) => {
    const salary = parseSalary(
      job.compensation?.scrapeableCompensationSalarySummary ??
        job.compensation?.compensationTierSummary,
    );
    return {
      id: `ashby:${company.slug}:${job.id}`,
      source: "ashby",
      title: job.title,
      companyName: company.name ?? company.slug,
      location: cleanLocation(job.location),
      description: stripHtml(job.descriptionHtml),
      url: job.jobUrl ?? `https://jobs.ashbyhq.com/${company.slug}`,
      salaryMin: salary.min,
      salaryMax: salary.max,
      salaryCurrency: salary.currency,
      contractType: job.employmentType ?? null,
      remote: Boolean(job.isRemote),
      postedAt: job.publishedAt ?? null,
    };
  });
}

export async function fetchWorkable(company: AtsCompany): Promise<RawJob[]> {
  const data = await getJson<{ name?: string; jobs?: WorkableJob[] }>(boardUrl(company));
  return (data?.jobs ?? []).map((job, index) => {
    const location =
      [job.location?.city, job.location?.country].filter(Boolean).join(", ") || null;
    return {
      id: `workable:${company.slug}:${job.shortcode ?? index}`,
      source: "workable",
      title: job.title ?? "Untitled role",
      companyName: company.name ?? data?.name ?? company.slug,
      location: cleanLocation(location),
      description: stripHtml(job.description),
      url: job.url ?? `https://apply.workable.com/${company.slug}/`,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      contractType: null,
      remote: /\bremote\b/i.test(location ?? ""),
      postedAt: job.created_at ?? null,
    };
  });
}

export async function fetchSmartRecruiters(company: AtsCompany): Promise<RawJob[]> {
  const data = await getJson<{ content?: SmartRecruitersJob[] }>(boardUrl(company));
  return (data?.content ?? []).map((job, index) => {
    const location =
      [job.location?.city, job.location?.country].filter(Boolean).join(", ") || null;
    return {
      id: `smartrecruiters:${company.slug}:${job.id ?? index}`,
      source: "smartrecruiters",
      title: job.name ?? "Untitled role",
      companyName: company.name ?? company.slug,
      location: cleanLocation(location),
      // The list endpoint has no description; a detail call per job would be
      // one request each, so classification uses the title only.
      description: null,
      url: `https://jobs.smartrecruiters.com/${company.slug}/${job.id ?? ""}`,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      contractType: null,
      remote: Boolean(job.location?.remote),
      postedAt: job.releasedDate ?? null,
    };
  });
}

export async function fetchAts(company: AtsCompany): Promise<RawJob[]> {
  switch (company.kind) {
    case "greenhouse":
      return fetchGreenhouse(company);
    case "lever":
      return fetchLever(company);
    case "ashby":
      return fetchAshby(company);
    case "workable":
      return fetchWorkable(company);
    case "smartrecruiters":
      return fetchSmartRecruiters(company);
  }
}
