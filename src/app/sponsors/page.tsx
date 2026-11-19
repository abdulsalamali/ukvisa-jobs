"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { dataUrl } from "@/lib/basePath";

interface SponsorRow {
  slug: string;
  name: string;
  rating: string | null;
  towns: string[];
  routes: string[];
  townCount: number;
}

interface SponsorIndex {
  total: number;
  shards: Record<string, number>;
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const MAX_ROWS = 200;

export default function SponsorsPage() {
  const [index, setIndex] = useState<SponsorIndex | null>(null);
  const [letter, setLetter] = useState("a");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SponsorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(dataUrl("sponsors-index.json"))
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SponsorIndex | null) => setIndex(data))
      .catch(() => setIndex(null));
  }, []);

  // Only one letter of the register is loaded at a time; 126k rows would be a
  // ~10 MB download otherwise.
  const shard = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle) {
      const first = needle[0];
      return /[a-z]/.test(first) ? first : "other";
    }
    return letter;
  }, [q, letter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(dataUrl(`sponsors-${shard}.json`))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: SponsorRow[]) => {
        if (!cancelled) setRows(data);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setRows([]);
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shard]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(needle));
  }, [rows, q]);

  const visible = filtered.slice(0, MAX_ROWS);

  return (
    <div className="container">
      <h1 style={{ fontSize: 26 }}>Licensed sponsor directory</h1>
      <p className="lede">
        Every organisation on the Home Office register of Worker and Temporary Worker sponsors,
        deduplicated by legal name. A licence means the employer <em>may</em> sponsor — not that
        they are hiring.
      </p>

      <div className="card" style={{ marginBottom: 18 }}>
        <label className="tiny muted" htmlFor="sponsor-q">
          Organisation
        </label>
        <input
          id="sponsor-q"
          className="input"
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="e.g. Monzo, NHS, Deloitte"
        />
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          The directory is split by first letter to keep downloads small; search works within the
          letter of your query.
        </p>
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        {LETTERS.map((value) => (
          <button
            key={value}
            type="button"
            className="chip"
            onClick={() => {
              setQ("");
              setLetter(value);
            }}
            style={{
              cursor: "pointer",
              background: !q && letter === value ? "var(--brand)" : undefined,
              color: !q && letter === value ? "#fff" : undefined,
            }}
          >
            {value.toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          onClick={() => {
            setQ("");
            setLetter("other");
          }}
          style={{ cursor: "pointer" }}
        >
          #
        </button>
      </div>

      <p className="small muted">
        {index ? `${index.total.toLocaleString("en-GB")} organisations` : "Loading directory…"}
        {q ? ` · matching “${q.trim()}”` : ` · letter ${shard.toUpperCase()}`}
      </p>

      {loading && <div className="empty">Loading…</div>}
      {error && <div className="empty">Could not load sponsors: {error}</div>}

      {!loading && !error && visible.length === 0 && (
        <div className="empty">No sponsors match that search.</div>
      )}

      {visible.length > 0 && (
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
            {visible.map((sponsor) => (
              <tr key={sponsor.slug}>
                <td className="name">
                  <Link href={`/company/${sponsor.slug}`}>{sponsor.name}</Link>
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

      {filtered.length > MAX_ROWS && (
        <p className="tiny muted">
          Showing the first {MAX_ROWS} of {filtered.length.toLocaleString("en-GB")} matches — add
          more letters to narrow it down.
        </p>
      )}
    </div>
  );
}
