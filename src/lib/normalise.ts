// Employer-name normalisation, used to join job postings to the
// Home Office sponsor register. Conservative on purpose: a false match
// ("Alpha Ltd" -> "Alpha Beta Ltd") is worse than no match, because it
// would label an unsponsored job as sponsored.

const LEGAL_SUFFIXES = new Set([
  "limited",
  "ltd",
  "plc",
  "llp",
  "lp",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "company",
  "co",
  "group",
  "holdings",
  "holding",
  "uk",
  "gb",
  "com",
  "net",
]);

export function normaliseOrg(raw: string): string {
  let s = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9]+/g, " ").trim();

  const tokens = s.split(" ").filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

/** "Tesco PLC" and "TescoPLC" both become "tescoplc". */
export function compactOrg(normalised: string): string {
  return normalised.replace(/[^a-z0-9]/g, "");
}

/**
 * Many register entries are legal name plus trading name, e.g.
 * "Roofoods Ltd t/a Deliveroo". Job ads use the trading name, so index both.
 */
export function tradingName(orgName: string): string | null {
  const match = orgName.match(/(?:\bt\/a\b|\btrading as\b|\bformerly\b)\s+(.+)$/i);
  if (!match) return null;
  const cleaned = match[1].replace(/\(.*?\)/g, "").trim();
  return cleaned ? normaliseOrg(cleaned) : null;
}

export function slugify(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|br|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-z]+);/gi, (m, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** UK-ish location test, so we don't fill the board with Berlin roles. */
export function looksUk(location: string | null | undefined): boolean {
  if (!location) return false;
  const l = location.toLowerCase();
  if (/\b(uk|united kingdom|great britain|england|scotland|wales|northern ireland)\b/.test(l)) {
    return true;
  }
  return UK_PLACES.some((p) => l.includes(p));
}

export const UK_PLACES = [
  "london",
  "manchester",
  "birmingham",
  "leeds",
  "glasgow",
  "edinburgh",
  "bristol",
  "liverpool",
  "sheffield",
  "newcastle",
  "nottingham",
  "leicester",
  "coventry",
  "cardiff",
  "belfast",
  "reading",
  "cambridge",
  "oxford",
  "brighton",
  "southampton",
  "portsmouth",
  "exeter",
  "york",
  "bath",
  "norwich",
  "milton keynes",
  "slough",
  "watford",
  "croydon",
  "aberdeen",
  "dundee",
  "swansea",
  "derby",
  "stoke",
  "hull",
  "plymouth",
  "lancaster",
  "warwick",
  "guildford",
  "surrey",
  "kent",
  "essex",
  "hertfordshire",
];

/** Canonical city for filtering, e.g. "London, England" -> "London". */
export function deriveCity(location: string | null | undefined): string | null {
  if (!location) return null;
  const lower = location.toLowerCase();

  const hit = UK_PLACES.find((place) =>
    new RegExp(`(^|[^a-z])${place}([^a-z]|$)`).test(lower),
  );
  if (hit) {
    return hit.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }

  if (/\bremote\b/.test(lower)) return "Remote";

  const first = location.split(",")[0]?.trim();
  if (!first || first.length > 40) return null;

  // Country-level strings are not cities and would pollute the location filter.
  if (
    /^(uk|u\.k\.|united kingdom|england|scotland|wales|northern ireland|great britain|anywhere)$/i.test(
      first,
    )
  ) {
    return null;
  }
  return first;
}
