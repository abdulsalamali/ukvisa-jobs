import Link from "next/link";
import { notFound } from "next/navigation";
import { JobCard } from "@/components/JobCard";
import { db } from "@/lib/db";
import { getSponsor, getSponsorJobs } from "@/lib/queries";

export const dynamicParams = false;

/** Static export needs every company page enumerated at build time. */
export async function generateStaticParams() {
  const res = await db().execute(
    "SELECT DISTINCT sponsor_slug AS slug FROM jobs WHERE active = 1 AND sponsor_slug IS NOT NULL",
  );
  return res.rows.map((row) => ({ slug: String(row.slug) }));
}

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sponsor = await getSponsor(slug);
  if (!sponsor) notFound();

  const jobs = await getSponsorJobs(slug);

  return (
    <div className="container">
      <p className="tiny muted" style={{ marginBottom: 6 }}>
        <Link href="/sponsors">Sponsors</Link> / {sponsor.orgName}
      </p>

      <h1 style={{ fontSize: 26 }}>{sponsor.orgName}</h1>

      <div className="card" style={{ marginBottom: 20 }}>
        <dl className="detail-list">
          <dt>Licence rating</dt>
          <dd>
            {sponsor.rating ? (
              <span className={`badge ${sponsor.rating === "A" ? "good" : "warn"}`}>
                {sponsor.rating} rating
              </span>
            ) : (
              <span className="muted">Not stated</span>
            )}
          </dd>
          <dt>Routes</dt>
          <dd>{sponsor.routes.join(", ") || "—"}</dd>
          <dt>Registered towns</dt>
          <dd>
            {sponsor.towns.length > 0
              ? sponsor.towns.slice(0, 12).join(", ") +
                (sponsor.towns.length > 12 ? ` +${sponsor.towns.length - 12} more` : "")
              : "—"}
          </dd>
          <dt>Live jobs here</dt>
          <dd>{jobs.length}</dd>
        </dl>
        <p className="tiny muted" style={{ marginBottom: 0, marginTop: 14 }}>
          Source: Home Office register of licensed sponsors. An A rating means the employer is
          fully compliant; a B rating means they are subject to an action plan.
        </p>
      </div>

      <h2>Live vacancies from this sponsor</h2>
      {jobs.length === 0 ? (
        <div className="empty">
          No live listings captured from this employer yet. Their careers page is the next place
          to look — and adding their ATS to <code>config/ats-companies.json</code> would pull them
          in automatically.
        </div>
      ) : (
        <div className="jobs">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} showRelevance={false} />
          ))}
        </div>
      )}
    </div>
  );
}
