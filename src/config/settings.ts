// Central place for the numbers the classification rules depend on.
// Check these against GOV.UK before trusting them — they change.

export const SKILLED_WORKER_GENERAL_THRESHOLD = 41_700; // £/yr, from Jul 2025
export const SKILLED_WORKER_NEW_ENTRANT_THRESHOLD = 33_400; // £/yr, from Jul 2025

// New entrant = under 26, a recent graduate, or working towards a
// recognised qualification. PhD holders get a separate discount.
export const NEW_ENTRANT_MAX_AGE = 26;

export const SOURCE_LABELS: Record<string, string> = {
  greenhouse: "Employer (Greenhouse)",
  lever: "Employer (Lever)",
  ashby: "Employer (Ashby)",
  adzuna: "Adzuna",
  reed: "Reed",
  workday: "Employer (Workday)",
};
