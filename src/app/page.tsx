import Link from "next/link";
import { JobCard } from "@/components/JobCard";
import { CONFIDENCE_LABELS, FLAG_LABELS } from "@/lib/classify";
import { getStats, getTopCities, listJobs } from "@/lib/queries";
import { loadCvKeywords, loadProfile } from "@/lib/relevance";
import type { Confidence } from "@/lib/types";

const LEGEND_ORDER: Confidence[] = [
  "apply_with_confidence",
  "application_recommended",
  "unverified",
  "no_sponsorship",
];

export default async function HomePage() {
  const [stats, cities, matches] = await Promise.all([
    getStats(),
    getTopCities(8),
    listJobs({
      sort: "relevance",
      minRelevance: 25,
      confidence: ["apply_with_confidence", "application_recommended", "unverified"],
      pageSize: 6,
    }),
  ]);

  const profile = loadProfile();
  const cvKeywords = loadCvKeywords(profile);
  const visaValidUntil = profile.visa?.validUntil
    ? new Date(profile.visa.validUntil).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="container">
      <section className="hero">
        <p className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Personal board · {stats.jobs.toLocaleString("en-GB")} live jobs from{" "}
          {stats.employers.toLocaleString("en-GB")} tracked employers
        </p>
        <h1>Jobs at employers the Home Office has licensed to sponsor</h1>
        <p className="lede">
          Every employer here appears on the official register of licensed sponsors. Ads are
          matched to your CV, scored, and labelled with the evidence behind the score.
        </p>

        <div className="stat-row">
          <div className="stat">
            <b>{stats.jobs.toLocaleString("en-GB")}</b>
            <span>live UK vacancies</span>
          </div>
          <div className="stat">
            <b>{stats.employers.toLocaleString("en-GB")}</b>
            <span>employers tracked</span>
          </div>
          <div className="stat">
            <b>{stats.jobsThisWeek.toLocaleString("en-GB")}</b>
            <span>posted in the last 7 days</span>
          </div>
          <div className="stat">
            <b>{stats.confidence.apply_with_confidence.toLocaleString("en-GB")}</b>
            <span>sponsorship stated in the ad</span>
          </div>
          <div className="stat">
            <b>{stats.confidence.application_recommended.toLocaleString("en-GB")}</b>
            <span>from licensed sponsors</span>
          </div>
        </div>

        <p className="tiny muted" style={{ marginTop: 14, marginBottom: 0 }}>
          Coverage is honest, not exhaustive: the register lists{" "}
          {stats.sponsors.toLocaleString("en-GB")} licensed sponsors but contains no vacancies,
          so jobs appear here only for employers whose job feeds are tracked. It is not every
          sponsored job in the UK.
        </p>

        <p className="tiny muted" style={{ marginTop: 14, marginBottom: 0 }}>
          Sponsor register dated {stats.sourceDate ?? "unknown"}
          {stats.updatedAt
            ? ` · jobs refreshed ${new Date(stats.updatedAt).toLocaleDateString("en-GB")}`
            : ""}
        </p>
      </section>

      <div className="split split-home">
        <div className="stack">
          <section>
            <div className="results-head">
              <h2 style={{ margin: 0 }}>Best matches for your CV</h2>
              <Link className="btn secondary" href="/jobs?minRelevance=25">
                See all
              </Link>
            </div>

            {matches.items.length === 0 ? (
              <div className="empty">
                No jobs ingested yet. Run <code>npm run ingest</code> to pull the register and
                live listings.
              </div>
            ) : (
              <div className="jobs">
                {matches.items.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2>Where the jobs are</h2>
            <div className="chips">
              {cities.map((city) => (
                <Link key={city.city} className="chip" href={`/jobs?city=${encodeURIComponent(city.city)}`}>
                  {city.city} <b>{city.jobs}</b>
                </Link>
              ))}
              {cities.length === 0 && <span className="muted small">No locations yet.</span>}
            </div>
          </section>

          <section>
            <h2>What the labels mean</h2>
            <div className="legend">
              {LEGEND_ORDER.map((key) => {
                const label = CONFIDENCE_LABELS[key];
                return (
                  <div key={key} className="legend-item">
                    <span className={`badge ${label.tone}`}>{label.short}</span>
                    <p>{label.long}</p>
                  </div>
                );
              })}
            </div>
            <div className="legend" style={{ marginTop: 12 }}>
              {(Object.keys(FLAG_LABELS) as (keyof typeof FLAG_LABELS)[]).map((key) => (
                <div key={key} className="legend-item">
                  <span className="badge warn">{FLAG_LABELS[key].short}</span>
                  <p>{FLAG_LABELS[key].long}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="stack">
          <div className="card">
            <h2 style={{ fontSize: 16 }}>Your profile</h2>
            <p className="small muted" style={{ marginTop: 0 }}>
              {profile.headline ?? "No profile configured"}
            </p>

            {profile.visa && (
              <p className="visa">
                <strong>{profile.visa.route} visa</strong>
                {visaValidUntil ? ` · valid to ${visaValidUntil}` : ""}
                {profile.visa.note ? (
                  <>
                    <br />
                    {profile.visa.note}
                  </>
                ) : null}
              </p>
            )}

            <dl className="detail-list" style={{ marginTop: 14 }}>
              <dt>Target fields</dt>
              <dd>{profile.fields.map((field) => field.name).join(", ") || "—"}</dd>
              <dt>Locations</dt>
              <dd>{profile.locations.map((place) => place.name).join(", ") || "—"}</dd>
              <dt>Skills tracked</dt>
              <dd>{profile.skills.length}</dd>
              <dt>CV keywords</dt>
              <dd>
                {cvKeywords.length > 0
                  ? `${cvKeywords.length} extracted`
                  : "Add config/cv.md to unlock CV matching"}
              </dd>
            </dl>
          </div>

          <div className="card">
            <h2 style={{ fontSize: 16 }}>Sponsor directory</h2>
            <p className="small muted" style={{ marginTop: 0 }}>
              Search all {stats.sponsors.toLocaleString("en-GB")} licensed organisations by name,
              town or visa route.
            </p>
            <Link className="btn" href="/sponsors">
              Browse sponsors
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
