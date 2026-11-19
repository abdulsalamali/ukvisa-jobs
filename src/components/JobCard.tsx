import Link from "next/link";
import { CONFIDENCE_LABELS, FLAG_LABELS, JOB_TYPE_LABELS } from "@/lib/classify";
import { SOURCE_LABELS } from "@/config/settings";
import type { JobListItem } from "@/lib/queries";

function money(min: number | null, max: number | null, currency: string | null): string | null {
  if (!min && !max) return null;
  const symbol = currency === "GBP" || !currency ? "£" : "";
  const fmt = (n: number) => `${symbol}${Math.round(n).toLocaleString("en-GB")}`;
  if (min && max && Math.round(min) !== Math.round(max)) return `${fmt(min)}–${fmt(max)}`;
  return fmt((max ?? min) as number);
}

function relativeDate(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const days = Math.floor((Date.now() - time) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function JobCard({
  job,
  showRelevance = true,
}: {
  job: JobListItem;
  showRelevance?: boolean;
}) {
  const label = CONFIDENCE_LABELS[job.confidence];
  const salary = money(job.salaryMin, job.salaryMax, job.salaryCurrency);
  const posted = relativeDate(job.postedAt);

  return (
    <article className="job">
      <div className="job-head">
        <div>
          <h3 className="job-title">
            <a href={job.url} target="_blank" rel="noopener noreferrer">
              {job.title}
            </a>
          </h3>
          <p className="job-meta">
            {job.sponsorSlug ? (
              <Link href={`/company/${job.sponsorSlug}`}>{job.companyName}</Link>
            ) : (
              <span>{job.companyName}</span>
            )}
            {job.location && (
              <>
                <span className="dot">·</span>
                <span>{job.location}</span>
              </>
            )}
            {salary && (
              <>
                <span className="dot">·</span>
                <span>{salary}</span>
              </>
            )}
            {posted && (
              <>
                <span className="dot">·</span>
                <span>{posted}</span>
              </>
            )}
            <span className="dot">·</span>
            <span className="tiny">{SOURCE_LABELS[job.source] ?? job.source}</span>
          </p>
        </div>
        {showRelevance && job.relevance > 0 && (
          <div className="score" title="How well this matches your profile and CV">
            <b>{job.relevance}</b>
            <span>/100</span>
          </div>
        )}
      </div>

      <div className="badges">
        <span className={`badge ${label.tone}`} title={label.long}>
          {label.short}
        </span>
        {job.flags.map((flag) => (
          <span key={flag} className="badge warn" title={FLAG_LABELS[flag].long}>
            {FLAG_LABELS[flag].short}
          </span>
        ))}
        <span className="badge ghost">{JOB_TYPE_LABELS[job.jobType]}</span>
      </div>

      {job.relevanceSignals.length > 0 && (
        <ul className="signals">
          {job.relevanceSignals.map((signal) => (
            <li key={signal}>{signal}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
