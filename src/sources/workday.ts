import type { RawJob } from "../lib/types";

/**
 * Workday sites. This is the same JSON endpoint the employer's own careers
 * page calls, so no access control is bypassed. Only sites whose robots.txt
 * allows the path are crawled, pages are throttled, and we store the title,
 * location, URL and posting date rather than mirroring the ad text.
 */
export interface WorkdayCompany {
  name: string;
  /** e.g. "barclays.wd3.myworkdayjobs.com" */
  host: string;
  /** e.g. "External_Career_Site_Barclays" */
  site: string;
  /** Optional keyword filter applied server-side. */
  searchText?: string;
  /**
   * Preferred over deep pagination: each term costs one request, so this
   * reaches relevant roles without tripping Workday's rate limit.
   */
  searchTerms?: string[];
  /** Pages per search term. Defaults to 1 when searchTerms is set, else 8. */
  pagesPerSearch?: number;
  /** Defaults to 100. */
  maxJobs?: number;
}

const PAGE_SIZE = 20;
const MAX_PAGES = 8;
const DELAY_MS = 2_500;
const USER_AGENT = "ukvisa-jobs/0.1 (personal job board; respects robots.txt)";

interface WorkdayPosting {
  title?: string;
  externalPath?: string;
  path?: string;
  locationsText?: string;
  location?: string;
  postedOn?: string;
  timeType?: string;
}

interface WorkdayResponse {
  total?: number;
  jobPostings?: WorkdayPosting[];
  jobs?: WorkdayPosting[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Minimal robots.txt check for the `User-agent: *` group. Deny-by-default on
 * matches, with the longest matching rule winning, as the spec requires.
 */
export async function robotsAllows(host: string, path: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${host}/robots.txt`, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return true;
    const text = await res.text();

    let inStarGroup = false;
    let best: { allow: boolean; length: number } = { allow: true, length: 0 };

    for (const rawLine of text.split("\n")) {
      const line = rawLine.split("#")[0].trim();
      if (!line) continue;
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();

      if (key === "user-agent") {
        inStarGroup = value === "*";
        continue;
      }
      if (!inStarGroup || !value) continue;
      if (key !== "allow" && key !== "disallow") continue;

      if (path.startsWith(value) && value.length > best.length) {
        best = { allow: key === "allow", length: value.length };
      }
    }
    return best.allow;
  } catch {
    // A missing or unreachable robots.txt is not a disallow.
    return true;
  }
}

function parsePostedOn(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.toLowerCase();
  const days = (count: number) => new Date(Date.now() - count * 86_400_000).toISOString();

  if (text.includes("today")) return days(0);
  if (text.includes("yesterday")) return days(1);
  const match = text.match(/(\d+)\+?\s*day/);
  if (match) return days(Number(match[1]));
  const weeks = text.match(/(\d+)\+?\s*week/);
  if (weeks) return days(Number(weeks[1]) * 7);
  const months = text.match(/(\d+)\+?\s*month/);
  if (months) return days(Number(months[1]) * 30);
  return null;
}

/**
 * Workday answers 429 quickly if you page faster than it likes. Back off,
 * honour Retry-After, and give up after a few attempts rather than hammering.
 */
async function postJobs(
  endpoint: string,
  body: unknown,
  attempt = 0,
): Promise<{ ok: true; data: WorkdayResponse } | { ok: false; status: number }> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    if (res.status === 429 || res.status === 503) {
      if (attempt >= 3) return { ok: false, status: res.status };
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1_000
        : 5_000 * (attempt + 1);
      console.warn(`[workday] rate limited (${res.status}); waiting ${Math.round(wait / 1000)}s`);
      await sleep(Math.min(wait, 30_000));
      return postJobs(endpoint, body, attempt + 1);
    }

    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as WorkdayResponse };
  } catch {
    if (attempt >= 2) return { ok: false, status: 0 };
    await sleep(2_000);
    return postJobs(endpoint, body, attempt + 1);
  }
}

export async function fetchWorkday(company: WorkdayCompany): Promise<RawJob[]> {
  const allowed = await robotsAllows(company.host, `/${company.site}/`);
  if (!allowed) {
    console.warn(`[workday] ${company.name}: robots.txt disallows /${company.site}/ — skipped`);
    return [];
  }

  const tenant = company.host.split(".")[0];
  const endpoint = `https://${company.host}/wday/cxs/${tenant}/${company.site}/jobs`;
  const maxJobs = company.maxJobs ?? 100;
  const searches = company.searchTerms?.length
    ? company.searchTerms
    : [company.searchText ?? ""];
  const pagesPerSearch = company.pagesPerSearch ?? (company.searchTerms?.length ? 1 : 8);

  const byId = new Map<string, RawJob>();

  // Targeted searches are gentler than deep pagination: Workday rate-limits
  // per page, and a keyword search reaches relevant roles in one request.
  for (const searchText of searches) {
    for (let page = 0; page < pagesPerSearch && byId.size < maxJobs; page += 1) {
      const offset = page * PAGE_SIZE;

      const result = await postJobs(endpoint, {
        appliedFacets: {},
        limit: PAGE_SIZE,
        offset,
        searchText,
      });

      if (!result.ok) {
        console.warn(
          `[workday] ${company.name}: "${searchText}" stopped at offset ${offset} (HTTP ${result.status})`,
        );
        break;
      }

      const postings = result.data.jobPostings ?? result.data.jobs ?? [];
      if (postings.length === 0) break;

      for (const posting of postings) {
        const path = posting.externalPath ?? posting.path ?? null;
        if (!path) continue;

        const id = `workday:${company.host}:${path}`;
        if (byId.has(id)) continue;

        byId.set(id, {
          id,
          source: "workday",
          title: posting.title ?? "Untitled role",
          companyName: company.name,
          location: posting.locationsText ?? posting.location ?? null,
          // The feed carries no description; fetching each one would multiply
          // requests by 20. Classification therefore uses the title only.
          description: null,
          url: `https://${company.host}/${company.site}${path}`,
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
          contractType: posting.timeType ?? null,
          remote: /\bremote\b/i.test(posting.locationsText ?? ""),
          postedAt: parsePostedOn(posting.postedOn),
        });
      }

      const total = result.data.total ?? 0;
      if (offset + PAGE_SIZE >= total) break;
      await sleep(DELAY_MS);
    }

    await sleep(DELAY_MS);
  }

  return [...byId.values()];
}
