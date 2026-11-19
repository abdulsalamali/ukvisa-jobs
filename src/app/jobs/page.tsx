import Link from "next/link";
import { JobCard } from "@/components/JobCard";
import { JobTypeFilter } from "@/components/JobTypeFilter";
import { SortSelect } from "@/components/SortSelect";
import {
  getTopCities,
  getTypeCounts,
  listJobs,
  type JobFilters,
  type SortKey,
} from "@/lib/queries";
import { CONFIDENCE_LABELS } from "@/lib/classify";
import type { Confidence, JobType } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const DEFAULT_CONFIDENCE: Confidence[] = [
  "apply_with_confidence",
  "application_recommended",
  "unverified",
  "no_sponsorship",
];

const CONFIDENCE_ORDER: Confidence[] = [
  "apply_with_confidence",
  "application_recommended",
  "unverified",
  "no_sponsorship",
];

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function pageHref(params: SearchParams, page: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page") continue;
    for (const item of toArray(value)) search.append(key, item);
  }
  search.set("page", String(page));
  return `/jobs?${search.toString()}`;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : "";
  const city = typeof params.city === "string" ? params.city : "";
  const types = toArray(params.type);
  const confidenceParam = toArray(params.confidence) as Confidence[];
  const confidence = confidenceParam.length > 0 ? confidenceParam : DEFAULT_CONFIDENCE;
  const sort = (typeof params.sort === "string" ? params.sort : "relevance") as SortKey;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const minRelevance = Number(params.minRelevance ?? 0) || 0;

  const filters: JobFilters = {
    q: q || undefined,
    city: city || undefined,
    types: types.length ? (types as JobType[]) : undefined,
    confidence,
    minRelevance: minRelevance || undefined,
    sort,
    page,
    pageSize: 20,
  };

  const [results, typeCounts, cities] = await Promise.all([
    listJobs(filters),
    getTypeCounts(),
    getTopCities(40),
  ]);

  const totalPages = Math.max(1, Math.ceil(results.total / results.pageSize));
  const showing = results.items.length;

  return (
    <div className="container">
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26 }}>Sponsored UK jobs</h1>
        <p className="lede" style={{ marginBottom: 0 }}>
          Filter by job type, sponsorship confidence and location. Scores reflect how closely each
          role matches your profile and CV.
        </p>
      </div>

      <form method="get" action="/jobs">
        <div className="split">
          <aside className="filters">
            <div className="filter-group">
              <label className="group-label" htmlFor="q">
                Search
              </label>
              <input
                id="q"
                className="input"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Job title or company"
              />
            </div>

            <div className="filter-group">
              <label className="group-label" htmlFor="city">
                Location
              </label>
              <select id="city" className="select" name="city" defaultValue={city}>
                <option value="">All UK</option>
                {cities.map((item) => (
                  <option key={item.city} value={item.city}>
                    {item.city} ({item.jobs})
                  </option>
                ))}
              </select>
            </div>

            <JobTypeFilter counts={typeCounts} selected={types} />

            <fieldset className="filter-group">
              <legend>Sponsorship</legend>
              {CONFIDENCE_ORDER.map((key) => {
                const label = CONFIDENCE_LABELS[key];
                return (
                  <label key={key}>
                    <input
                      type="checkbox"
                      name="confidence"
                      value={key}
                      defaultChecked={confidence.includes(key)}
                    />
                    <span>{label.short}</span>
                  </label>
                );
              })}
            </fieldset>

            {minRelevance > 0 && (
              <input type="hidden" name="minRelevance" value={minRelevance} />
            )}

            <button className="btn" type="submit" style={{ width: "100%" }}>
              Apply filters
            </button>
            <p className="tiny muted" style={{ marginBottom: 0 }}>
              <Link href="/jobs">Reset</Link>
            </p>
          </aside>

          <section>
            <div className="results-head">
              <span className="count-line">
                <strong>{results.total.toLocaleString("en-GB")}</strong> jobs
                {city ? ` in ${city}` : ""} · showing {showing} on page {results.page} of{" "}
                {totalPages}
              </span>
              <div className="sort-form">
                <span>Sort</span>
                <SortSelect value={sort} />
              </div>
            </div>

            {results.items.length === 0 ? (
              <div className="empty">
                No jobs match these filters. Try{" "}
                <Link href="/jobs">clearing them</Link>.
              </div>
            ) : (
              <div className="jobs">
                {results.items.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <nav className="pagination" aria-label="Pagination">
                {results.page > 1 && <Link href={pageHref(params, results.page - 1)}>Previous</Link>}
                {Array.from({ length: Math.min(7, totalPages) }, (_value, index) => {
                  const first = Math.max(1, Math.min(results.page - 3, totalPages - 6));
                  const number = first + index;
                  if (number > totalPages) return null;
                  return number === results.page ? (
                    <span key={number} className="current">
                      {number}
                    </span>
                  ) : (
                    <Link key={number} href={pageHref(params, number)}>
                      {number}
                    </Link>
                  );
                })}
                {results.page < totalPages && (
                  <Link href={pageHref(params, results.page + 1)}>Next</Link>
                )}
              </nav>
            )}
          </section>
        </div>
      </form>
    </div>
  );
}
