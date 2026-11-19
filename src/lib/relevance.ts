import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Relevance scoring. Deliberately simple and explainable: every point added
 * produces a human-readable reason, which the UI shows under the job. Nothing
 * here is a model — it is keyword evidence plus your own profile weights.
 */

export interface ProfileField {
  name: string;
  keywords: string[];
  /** Phrases that should cancel a match, e.g. "security guard" for cyber roles. */
  exclude?: string[];
  /** 0–1 multiplier on this field's points. GRC at 1 beats software at 0.5. */
  weight?: number;
}

export interface ProfileLocation {
  name: string;
  weight: number;
}

export interface Profile {
  headline?: string;
  visa?: { route: string; validUntil: string; note?: string };
  fields: ProfileField[];
  skills: string[];
  locations: ProfileLocation[];
  /** Points for any other UK location. The board is UK-only, so this is never zero. */
  locationBaseline?: number;
  /** "early" penalises senior/director roles that would be a stretch. */
  seniorityTarget?: "early" | "any";
  cvPath?: string;
}

export interface RelevanceInput {
  title: string;
  description: string | null;
  location: string | null;
  jobType: string;
  jobCategory: string;
  confidence: string;
  postedAt: string | null;
}

export interface Relevance {
  score: number;
  signals: string[];
  fields: string[];
}

const STOPWORDS = new Set([
  "the","and","for","with","you","your","our","are","will","that","this","have","has","from",
  "they","their","who","not","but","all","can","any","was","were","been","being","more","most",
  "into","over","also","such","than","then","them","these","those","what","when","which","while",
  "work","working","role","team","teams","job","jobs","company","candidate","candidates","apply",
  "experience","years","year","including","within","across","using","use","used","help","support",
  "able","about","other","well","make","made","new","one","two","its","we're","we",
]);

const SENIORITY_PENALTY: Record<string, number> = {
  director: 28,
  mid_senior: 18,
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary match that also handles multi-word phrases and punctuation. */
function containsPhrase(haystack: string, phrase: string): boolean {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(phrase)}([^a-z0-9]|$)`);
  return pattern.test(haystack);
}

export function loadProfile(): Profile {
  const base = path.join(process.cwd(), "config/profile.json");
  const local = path.join(process.cwd(), "config/profile.local.json");

  if (!existsSync(base)) {
    return { fields: [], skills: [], locations: [] };
  }

  const parsed = JSON.parse(readFileSync(base, "utf8")) as Profile;

  // Personal overrides (visa status, CV path) live in an untracked file so the
  // repository can be public while your own build stays tailored.
  if (existsSync(local)) {
    const overrides = JSON.parse(readFileSync(local, "utf8")) as Partial<Profile>;
    Object.assign(parsed, overrides);
  }

  // Backwards compatibility with the first iteration of the profile format,
  // which stored locations as plain strings.
  parsed.locations = (parsed.locations ?? []).map((location) =>
    typeof location === "string" ? { name: location, weight: 10 } : location,
  );
  return parsed;
}

/** Pull candidate keywords out of a pasted CV, most frequent first. */
export function extractCvKeywords(cvText: string, limit = 40): string[] {
  const text = cvText.toLowerCase();
  const counts = new Map<string, number>();

  for (const word of text.split(/[^a-z0-9+#.\-]+/)) {
    if (word.length < 3 || word.length > 30) continue;
    if (STOPWORDS.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  // Two-word phrases catch things like "incident response" and "threat hunting".
  const tokens = text.split(/[^a-z0-9+#.\-]+/).filter((t) => t.length > 1);
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (STOPWORDS.has(a) || STOPWORDS.has(b)) continue;
    if (a.length < 3 || b.length < 3) continue;
    const phrase = `${a} ${b}`;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([phrase]) => phrase);
}

export function loadCvKeywords(profile: Profile): string[] {
  const cvPath = profile.cvPath ?? "config/cv.md";
  const file = path.join(process.cwd(), cvPath);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  if (text.trim().length < 100) return [];
  return extractCvKeywords(text);
}

export function scoreRelevance(
  job: RelevanceInput,
  profile: Profile,
  cvKeywords: string[],
): Relevance {
  const title = job.title.toLowerCase();
  const body = `${job.title}\n${job.description ?? ""}`.toLowerCase();
  const location = (job.location ?? "").toLowerCase();

  let score = 0;
  const signals: string[] = [];
  const fields: string[] = [];

  /* --- 1. Target field match (max 30) ------------------------------ */

  const bestField = (matchTitle: boolean) => {
    let best: { field: ProfileField; hit: string; points: number } | null = null;

    for (const field of profile.fields) {
      const excluded = (field.exclude ?? []).some((phrase) =>
        containsPhrase(body, phrase.toLowerCase()),
      );
      if (excluded) continue;

      const haystack = matchTitle ? title : body;
      const hit = field.keywords.find((k) => containsPhrase(haystack, k.toLowerCase()));
      if (!hit) continue;

      const weight = field.weight ?? 1;
      const points = Math.round((matchTitle ? 30 : 12) * weight);
      if (!best || points > best.points) best = { field, hit, points };
    }
    return best;
  };

  const titleMatch = bestField(true);
  if (titleMatch) {
    score += titleMatch.points;
    fields.push(titleMatch.field.name);
    signals.push(`Title matches ${titleMatch.field.name} (“${titleMatch.hit}”)`);
  } else {
    const bodyMatch = bestField(false);
    if (bodyMatch) {
      score += bodyMatch.points;
      fields.push(bodyMatch.field.name);
      signals.push(`Description mentions ${bodyMatch.field.name} (“${bodyMatch.hit}”)`);
    }
  }

  /* --- 2. Your listed skills (max 20) ------------------------------ */

  let skillHits = 0;
  for (const skill of profile.skills) {
    if (containsPhrase(body, skill.toLowerCase())) skillHits += 1;
  }
  if (skillHits > 0) {
    score += Math.min(20, skillHits * 4);
    signals.push(`${skillHits} of your listed skill${skillHits === 1 ? "" : "s"} appear in the ad`);
  }

  /* --- 3. CV overlap (max 20) -------------------------------------- */

  let cvHits = 0;
  const cvMatched: string[] = [];
  for (const keyword of cvKeywords) {
    if (cvMatched.length >= 6) break;
    if (containsPhrase(body, keyword)) {
      cvHits += 1;
      cvMatched.push(keyword);
    }
  }
  if (cvHits > 0) {
    score += Math.min(20, cvHits * 3);
    signals.push(`Overlaps your CV: ${cvMatched.slice(0, 4).join(", ")}`);
  }

  /* --- 4. Location (weighted, plus UK baseline) --------------------- */

  const wanted = profile.locations.find((place) =>
    location.includes(place.name.toLowerCase()),
  );
  if (wanted) {
    score += wanted.weight;
    signals.push(`In your preferred location (${wanted.name})`);
  } else if (location) {
    const baseline = profile.locationBaseline ?? 3;
    score += baseline;
    if (baseline > 0) signals.push("Anywhere in the UK");
  }

  /* --- 5. Seniority fit -------------------------------------------- */

  if (profile.seniorityTarget === "early") {
    const penalty = SENIORITY_PENALTY[job.jobType];
    if (penalty) {
      score -= penalty;
      signals.push(`Seniority is above your target level (−${penalty})`);
    }
  }

  /* --- 6. Sponsorship and timing ----------------------------------- */

  if (job.confidence === "apply_with_confidence") {
    score += 8;
    signals.push("Sponsorship stated in the ad");
  } else if (job.confidence === "application_recommended") {
    score += 4;
    signals.push("Employer is a licensed sponsor");
  } else if (job.confidence === "no_sponsorship" && profile.visa) {
    // Your current visa already gives you the right to work, so a role that
    // refuses sponsorship is still applyable — it just won't extend your stay.
    score += 6;
    signals.push(
      `No sponsorship, but you can take this on your ${profile.visa.route} visa — it will not extend your stay`,
    );
  }

  if (job.jobCategory === "student_graduate") {
    score += 5;
  }

  if (job.postedAt) {
    const age = Date.now() - Date.parse(job.postedAt);
    if (Number.isFinite(age)) {
      if (age < 7 * 86_400_000) {
        score += 6;
        signals.push("Posted in the last week");
      } else if (age < 21 * 86_400_000) {
        score += 3;
      }
    }
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    signals: signals.slice(0, 5),
    fields: [...new Set(fields)],
  };
}

export function relevanceBand(score: number): "high" | "medium" | "low" {
  if (score >= 55) return "high";
  if (score >= 30) return "medium";
  return "low";
}
