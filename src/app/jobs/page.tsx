"use client";

import { useEffect, useMemo, useState } from "react";
import { JobCard } from "@/components/JobCard";
import { JobTypeFilter } from "@/components/JobTypeFilter";
import { CONFIDENCE_LABELS } from "@/lib/classify";
import { dataUrl } from "@/lib/basePath";
import type { JobListItem } from "@/lib/queries";
import type { Confidence } from "@/lib/types";

const PAGE_SIZE = 20;

const CONFIDENCE_ORDER: Confidence[] = [
  "apply_with_confidence",
  "application_recommended",
  "unverified",
  "no_sponsorship",
];

type SortKey = "relevance" | "newest" | "salary";

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<string[]>(CONFIDENCE_ORDER);
  const [sort, setSort] = useState<SortKey>("relevance");
  const [minRelevance, setMinRelevance] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = Number(params.get("minRelevance") ?? 0);
    if (Number.isFinite(value) && value > 0) setMinRelevance(value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl("jobs.json"))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: JobListItem[]) => {
        if (!cancelled) setJobs(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [q, city, types, confidence, sort, minRelevance]);

  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of jobs ?? []) {
      if (!job.city) continue;
      counts.set(job.city, (counts.get(job.city) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  }, [jobs]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const job of jobs ?? []) {
      counts[job.jobType] = (counts[job.jobType] ?? 0) + 1;
    }
    return counts;
  }, [jobs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (jobs ?? []).filter((job) => {
      if (job.relevance < minRelevance) return false;
      if (needle && !`${job.title} ${job.companyName}`.toLowerCase().includes(needle)) {
        return false;
      }
      if (city && job.city !== city) return false;
      if (types.length > 0 && !types.includes(job.jobType)) return false;
      if (confidence.length > 0 && !confidence.includes(job.confidence)) return false;
      return true;
    });

    const pay = (job: JobListItem) => job.salaryMax ?? job.salaryMin ?? 0;
    const time = (job: JobListItem) => (job.postedAt ? Date.parse(job.postedAt) : 0);

    if (sort === "newest") rows.sort((a, b) => time(b) - time(a));
    else if (sort === "salary") rows.sort((a, b) => pay(b) - pay(a));
    else rows.sort((a, b) => b.relevance - a.relevance);

    return rows;
  }, [jobs, q, city, types, confidence, sort, minRelevance]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggle = (list: string[], value: string, set: (next: string[]) => void) => {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  return (
    <div className="container">
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26 }}>Sponsored UK jobs</h1>
        <p className="lede" style={{ marginBottom: 0 }}>
          Filter by job type, sponsorship confidence and location. Scores reflect how closely each
          role matches your profile and CV.
        </p>
      </div>

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
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Job title or company"
            />
          </div>

          <div className="filter-group">
            <label className="group-label" htmlFor="city">
              Location
            </label>
            <select
              id="city"
              className="select"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            >
              <option value="">All UK</option>
              {cities.map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </select>
          </div>

          <JobTypeFilter
            counts={typeCounts}
            selected={types}
            onToggle={(type) => toggle(types, type, setTypes)}
          />

          <fieldset className="filter-group">
            <legend>Sponsorship</legend>
            {CONFIDENCE_ORDER.map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={confidence.includes(key)}
                  onChange={() => toggle(confidence, key, setConfidence)}
                />
                <span>{CONFIDENCE_LABELS[key].short}</span>
              </label>
            ))}
          </fieldset>

          <button
            className="btn secondary"
            type="button"
            style={{ width: "100%" }}
            onClick={() => {
              setQ("");
              setCity("");
              setTypes([]);
              setConfidence(CONFIDENCE_ORDER);
              setSort("relevance");
              setMinRelevance(0);
            }}
          >
            Reset filters
          </button>
        </aside>

        <section>
          <div className="results-head">
            <span className="count-line">
              {jobs === null ? (
                "Loading…"
              ) : (
                <>
                  <strong>{filtered.length.toLocaleString("en-GB")}</strong> jobs
                  {city ? ` in ${city}` : ""} · showing {visible.length} on page {page} of{" "}
                  {totalPages}
                </>
              )}
            </span>
            <div className="sort-form">
              <span>Sort</span>
              <select
                className="select"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                aria-label="Sort jobs"
              >
                <option value="relevance">Best match</option>
                <option value="newest">Newest</option>
                <option value="salary">Salary</option>
              </select>
            </div>
          </div>

          {error && <div className="empty">Could not load jobs: {error}</div>}

          {!error && jobs === null && <div className="empty">Loading jobs…</div>}

          {!error && jobs !== null && visible.length === 0 && (
            <div className="empty">No jobs match these filters.</div>
          )}

          {visible.length > 0 && (
            <div className="jobs">
              {visible.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <nav className="pagination" aria-label="Pagination">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page === 1}
              >
                Previous
              </button>
              <span className="current">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={page === totalPages}
              >
                Next
              </button>
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
