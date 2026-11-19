import Link from "next/link";
import { getRoutes, listSponsors } from "@/lib/queries";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function pageHref(params: SearchParams, page: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page") continue;
    const items = Array.isArray(value) ? value : value ? [value] : [];
    for (const item of items) search.append(key, item);
  }
  search.set("page", String(page));
  return `/sponsors?${search.toString()}`;
}

export default async function SponsorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const city = typeof params.city === "string" ? params.city : "";
  const route = typeof params.route === "string" ? params.route : "";
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const [results, routes] = await Promise.all([
    listSponsors({ q: q || undefined, city: city || undefined, route: route || undefined, page }),
    getRoutes(),
  ]);

  const totalPages = Math.max(1, Math.ceil(results.total / results.pageSize));

  return (
    <div className="container">
      <h1 style={{ fontSize: 26 }}>Licensed sponsor directory</h1>
      <p className="lede">
        Every organisation on the Home Office register of Worker and Temporary Worker sponsors,
        deduplicated by legal name. A licence means the employer <em>may</em> sponsor — not that
        they are hiring.
      </p>

      <form method="get" action="/sponsors" className="card" style={{ marginBottom: 18 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr auto",
            gap: 10,
            alignItems: "end",
          }}
        >
          <div>
            <label className="tiny muted" htmlFor="sponsor-q">
              Organisation
            </label>
            <input
              id="sponsor-q"
              className="input"
              type="search"
              name="q"
              defaultValue={q}
              placeholder="e.g. Monzo, NHS, Deloitte"
            />
          </div>
          <div>
            <label className="tiny muted" htmlFor="sponsor-city">
              Town / city
            </label>
            <input
              id="sponsor-city"
              className="input"
              type="search"
              name="city"
              defaultValue={city}
              placeholder="e.g. London"
            />
          </div>
          <div>
            <label className="tiny muted" htmlFor="sponsor-route">
              Route
            </label>
            <select id="sponsor-route" className="select" name="route" defaultValue={route}>
              <option value="">All routes</option>
              {routes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" type="submit">
            Search
          </button>
        </div>
      </form>

      <p className="small muted">
        {results.total.toLocaleString("en-GB")} organisations · page {results.page} of{" "}
        {totalPages}
      </p>

      {results.items.length === 0 ? (
        <div className="empty">No sponsors match that search.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Organisation</th>
              <th>Rating</th>
              <th>Routes</th>
              <th>Towns</th>
            </tr>
          </thead>
          <tbody>
            {results.items.map((sponsor) => (
              <tr key={sponsor.slug}>
                <td className="name">
                  <Link href={`/company/${sponsor.slug}`}>{sponsor.orgName}</Link>
                </td>
                <td>
                  {sponsor.rating ? (
                    <span className={`badge ${sponsor.rating === "A" ? "good" : "warn"}`}>
                      {sponsor.rating} rating
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="small">{sponsor.routes.join(", ") || "—"}</td>
                <td className="small muted">
                  {sponsor.towns.slice(0, 3).join(", ") || "—"}
                  {sponsor.townCount > 3 ? ` +${sponsor.townCount - 3}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    </div>
  );
}
