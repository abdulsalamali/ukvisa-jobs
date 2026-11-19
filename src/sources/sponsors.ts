import { parse } from "csv-parse/sync";
import { normaliseOrg, slugify } from "../lib/normalise";

export const REGISTER_PAGE =
  "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers";

export interface SponsorRow {
  orgName: string;
  orgNorm: string;
  town: string | null;
  county: string | null;
  rating: string | null;
  route: string | null;
}

export interface Sponsor {
  slug: string;
  orgName: string;
  orgNorm: string;
  towns: string[];
  routes: string[];
  rating: string | null;
  townCount: number;
}

export interface RegisterSnapshot {
  sourceDate: string;
  sourceUrl: string;
  rows: SponsorRow[];
  sponsors: Sponsor[];
}

/**
 * The CSV filename changes every day, so resolve the current link from the
 * publication page instead of hardcoding an asset hash that will 404 tomorrow.
 */
export async function resolveRegisterUrl(): Promise<{ url: string; date: string }> {
  const res = await fetch(REGISTER_PAGE, {
    headers: { "user-agent": "ukvisa-jobs/0.1 (personal job board)" },
  });
  if (!res.ok) throw new Error(`GOV.UK page returned ${res.status}`);

  const html = await res.text();
  const match = html.match(
    /https:\/\/assets\.publishing\.service\.gov\.uk\/media\/[a-f0-9]+\/SP_-_Worker_and_Temporary_Worker_Web_Register_-_(\d{4}-\d{2}-\d{2})\.csv/,
  );
  if (!match) {
    throw new Error(
      "Could not find the register CSV link on the GOV.UK page — the page layout may have changed.",
    );
  }
  return { url: match[0], date: match[1] };
}

export async function downloadRegister(): Promise<{ csv: string; date: string; url: string }> {
  const { url, date } = await resolveRegisterUrl();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Register CSV returned ${res.status}`);
  return { csv: await res.text(), date, url };
}

function ratingOf(typeAndRating: string): string | null {
  const m = typeAndRating.match(/\(([AB])\s*rating\)/i);
  return m ? m[1].toUpperCase() : null;
}

export function parseRegister(csv: string, sourceDate: string): RegisterSnapshot {
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  }) as Record<string, string>[];

  const rows: SponsorRow[] = [];
  const byOrg = new Map<string, Sponsor>();

  for (const record of records) {
    const orgName = (record["Organisation Name"] ?? "").trim();
    if (!orgName) continue;

    const orgNorm = normaliseOrg(orgName);
    if (!orgNorm) continue;

    const town = (record["Town/City"] ?? "").trim() || null;
    const county = (record["County"] ?? "").trim() || null;
    const rating = ratingOf(record["Type & Rating"] ?? "");
    const route = (record["Route"] ?? "").trim() || null;

    rows.push({ orgName, orgNorm, town, county, rating, route });

    let sponsor = byOrg.get(orgNorm);
    if (!sponsor) {
      sponsor = {
        slug: slugify(orgName),
        orgName,
        orgNorm,
        towns: [],
        routes: [],
        rating,
        townCount: 0,
      };
      byOrg.set(orgNorm, sponsor);
    }
    // A licence can be "A" on one route and "B" on another; keep the best.
    if (rating === "A") sponsor.rating = "A";
    else if (rating && !sponsor.rating) sponsor.rating = rating;

    if (town && !sponsor.towns.includes(town)) sponsor.towns.push(town);
    if (route && !sponsor.routes.includes(route)) sponsor.routes.push(route);
  }

  const sponsors = [...byOrg.values()];
  for (const s of sponsors) {
    s.towns.sort((a, b) => a.localeCompare(b));
    s.routes.sort((a, b) => a.localeCompare(b));
    s.townCount = s.towns.length;
  }

  return { sourceDate, sourceUrl: REGISTER_PAGE, rows, sponsors };
}
