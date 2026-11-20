/**
 * Reads the minimum years of experience an ad asks for.
 *
 * Ads phrase this in a handful of ways — "5+ years of experience",
 * "1-2 years experience", "minimum of 3 years' experience" — and also mention
 * unrelated durations ("growing for 10 years"), so a match only counts when
 * the word "experience" appears nearby.
 */

const CONTEXT = /experience|\bexp\b|you have|you'll have|you will have|track record/i;

const RANGE = /(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi;
const PLUS = /(\d{1,2})\s*\+\s*(?:years?|yrs?)/gi;
const MINIMUM = /(?:at least|minimum(?: of)?|min\.?)\s*(\d{1,2})\s*(?:years?|yrs?)/gi;
const PLAIN = /(\d{1,2})\s*(?:years?|yrs?)/gi;

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const WORD_YEARS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*\+?\s*(?:years?|yrs?)\b/gi;

const MAX_PLAUSIBLE_YEARS = 15;
const CONTEXT_WINDOW = 50;

/** Explicit "you need none" beats any other reading. */
const NO_EXPERIENCE =
  /\bno\s+(?:prior\s+|previous\s+|formal\s+)?experience\b|\bexperience\s+(?:is\s+)?not\s+(?:required|necessary|needed)\b/i;

function hasContext(text: string, index: number, length: number): boolean {
  const start = Math.max(0, index - CONTEXT_WINDOW);
  const end = Math.min(text.length, index + length + CONTEXT_WINDOW);
  return CONTEXT.test(text.slice(start, end));
}

function plausible(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_PLAUSIBLE_YEARS;
}

export function extractExperienceYears(
  description: string | null | undefined,
): number | null {
  if (!description) return null;
  const text = description;

  if (NO_EXPERIENCE.test(text)) return 0;

  const values: number[] = [];

  // Ranges first, so "1-2 years" is not also read as a plain "2 years".
  for (const match of text.matchAll(RANGE)) {
    if (!hasContext(text, match.index ?? 0, match[0].length)) continue;
    const low = Number(match[1]);
    const high = Number(match[2]);
    if (!plausible(low) || !plausible(high)) continue;
    values.push(Math.min(low, high));
  }

  for (const match of text.matchAll(MINIMUM)) {
    if (!hasContext(text, match.index ?? 0, match[0].length)) continue;
    const value = Number(match[1]);
    if (plausible(value)) values.push(value);
  }

  for (const match of text.matchAll(PLUS)) {
    if (!hasContext(text, match.index ?? 0, match[0].length)) continue;
    const value = Number(match[1]);
    if (plausible(value)) values.push(value);
  }

  for (const match of text.matchAll(PLAIN)) {
    if (!hasContext(text, match.index ?? 0, match[0].length)) continue;
    const value = Number(match[1]);
    if (plausible(value)) values.push(value);
  }

  // Spelled-out requirements: "a minimum of five years' experience".
  for (const match of text.matchAll(WORD_YEARS)) {
    if (!hasContext(text, match.index ?? 0, match[0].length)) continue;
    const value = WORD_NUMBERS[match[1].toLowerCase()];
    if (value !== undefined) values.push(value);
  }

  if (values.length === 0) return null;
  // The lowest stated bar is the one that decides whether you can apply.
  return Math.min(...values);
}
