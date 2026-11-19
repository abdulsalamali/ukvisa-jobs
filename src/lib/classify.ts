import {
  SKILLED_WORKER_GENERAL_THRESHOLD,
  SKILLED_WORKER_NEW_ENTRANT_THRESHOLD,
} from "../config/settings";
import type {
  Confidence,
  JobCategory,
  JobFlag,
  JobType,
  Signal,
  SponsorRef,
} from "./types";

/* ------------------------------------------------------------------ */
/* Job type                                                            */
/* ------------------------------------------------------------------ */

type TypeRule = { type: JobType; re: RegExp };

// Order matters: the most specific title wins. "Graduate Associate" is a
// graduate role, not an associate role; "Associate Director" is a director.
const TYPE_RULES: TypeRule[] = [
  { type: "director", re: /\b(director|head of|vice president|vp|chief|c[toef]o)\b/i },
  { type: "insight", re: /\binsight\s+(programme|program|week|day|scheme|event)\b/i },
  { type: "placement", re: /\b(placement|year in industry|industrial placement|sandwich year)\b/i },
  { type: "internship", re: /\b(intern|internship|summer analyst|summer associate)\b/i },
  { type: "graduate", re: /\b(graduate|grad scheme|grad programme|grad program|graduate trainee)\b/i },
  { type: "mid_senior", re: /\b(senior|lead|principal|staff|manager|architect|specialist)\b/i },
  { type: "associate", re: /\bassociate\b/i },
  { type: "entry_level", re: /\b(entry[- ]level|junior|trainee|apprentice|apprenticeship|no experience)\b/i },
  // Most postings are plain individual-contributor roles ("Backend Engineer",
  // "Security Analyst"). Without a seniority word they belong in Entry Level.
  { type: "entry_level", re: /\b(engineer|analyst|developer|consultant|administrator|technician|coordinator)\b/i },
];

export function classifyJobType(title: string): JobType {
  for (const rule of TYPE_RULES) {
    if (rule.re.test(title)) return rule.type;
  }
  return "unspecified";
}

const STUDENT_GRADUATE_TYPES = new Set<JobType>([
  "graduate",
  "internship",
  "placement",
  "insight",
]);

export function categoryFor(type: JobType): JobCategory {
  if (STUDENT_GRADUATE_TYPES.has(type)) return "student_graduate";
  if (["entry_level", "associate", "mid_senior", "director"].includes(type)) {
    return "experienced_hire";
  }
  return "unspecified";
}

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  graduate: "Graduate",
  internship: "Internship",
  placement: "Placement",
  insight: "Insight Programme",
  entry_level: "Entry Level",
  associate: "Associate",
  mid_senior: "Mid-Senior",
  director: "Director",
  unspecified: "Unspecified",
};

export const CATEGORY_LABELS: Record<JobCategory, string> = {
  student_graduate: "Student & Graduate Jobs",
  experienced_hire: "Experienced Hire Jobs",
  unspecified: "Other",
};

/* ------------------------------------------------------------------ */
/* Sponsorship assessment                                              */
/* ------------------------------------------------------------------ */

// Explicitly refuses sponsorship. Checked before the positive patterns,
// because "we sponsor" and "we cannot sponsor" can both appear.
const NEGATIVE_RULES: { rule: string; re: RegExp }[] = [
  {
    rule: "explicit_refusal",
    re: /\b(?:cannot|can ?not|can't|unable to|not able to|will not|won't|do not|don't|does not|doesn't)\b[^.]{0,40}\bsponsor/i,
  },
  {
    rule: "no_sponsorship",
    re: /\b(?:no|without)\s+(?:visa\s+)?sponsorship\b/i,
  },
  {
    rule: "sponsorship_not_available",
    re: /\bsponsorship\s+(?:is\s+)?not\s+(?:available|offered|provided|possible|supported)\b/i,
  },
  {
    rule: "right_to_work_required",
    re: /\bmust\s+(?:already\s+)?(?:have|hold)\s+(?:the\s+)?(?:legal\s+|permanent\s+)?right\s+to\s+work\b/i,
  },
];

const POSITIVE_RULES: { rule: string; re: RegExp }[] = [
  {
    rule: "explicit_sponsorship_offer",
    re: /\b(?:we|company|employer|organisation|organization)\b[^.]{0,60}\bsponsor(?:s|ship)?\b/i,
  },
  {
    rule: "visa_sponsorship_available",
    re: /\bvisa\s+sponsorship\s+(?:is\s+)?(?:available|provided|offered|supported)\b/i,
  },
  {
    rule: "sponsorship_supported",
    re: /\bsponsorship\b[^.]{0,40}\b(?:available|provided|offered|supported|considered|included)\b/i,
  },
  {
    rule: "certificate_of_sponsorship",
    re: /\bcertificate\s+of\s+sponsorship\b/i,
  },
  {
    rule: "willing_to_sponsor",
    re: /\b(?:willing|happy|able)\s+to\s+sponsor\b/i,
  },
  {
    rule: "skilled_worker_route",
    re: /\bskilled\s+worker\s+(?:visa\s+)?(?:route|visa|sponsorship)\b/i,
  },
];

const NEW_ENTRANT_MENTION = /\bnew\s+entrant\b/i;
const PHD_MENTION = /\b(phd|dphil|doctorate|doctoral)\b/i;
const STUDENT_VISA_MENTION =
  /\b(student visa|graduate visa|hpi|high potential individual|post[- ]study|tier 4|switching from a student)\b/i;

function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length + 60);
  return text
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(
  text: string,
  rules: { rule: string; re: RegExp }[],
): { rule: string; detail: string } | null {
  for (const { rule, re } of rules) {
    const m = re.exec(text);
    if (m) {
      return { rule, detail: snippet(text, m.index, m[0].length) };
    }
  }
  return null;
}

export interface AssessmentInput {
  title: string;
  description: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  sponsor: SponsorRef | null;
}

export interface Assessment {
  confidence: Confidence;
  jobType: JobType;
  jobCategory: JobCategory;
  flags: JobFlag[];
  signals: Signal[];
}

export function assess(input: AssessmentInput): Assessment {
  const jobType = classifyJobType(input.title);
  const jobCategory = categoryFor(jobType);
  const description = (input.description ?? "").toLowerCase();
  const haystack = `${input.title}\n${description}`;
  const flags: JobFlag[] = [];
  const signals: Signal[] = [];

  /* --- 1. Sponsorship confidence --------------------------------- */

  const negative = firstMatch(haystack, NEGATIVE_RULES);
  const positive = firstMatch(haystack, POSITIVE_RULES);

  let confidence: Confidence;

  if (negative) {
    confidence = "no_sponsorship";
    signals.push({
      rule: negative.rule,
      detail: negative.detail,
    });
  } else if (positive) {
    confidence = "apply_with_confidence";
    signals.push({
      rule: positive.rule,
      detail: positive.detail,
    });
  } else if (input.sponsor) {
    confidence = "application_recommended";
    signals.push({
      rule: "on_sponsor_register",
      detail: `${input.sponsor.orgName} holds a ${
        input.sponsor.rating ?? "valid"
      } licence for ${input.sponsor.routes.join(", ") || "worker routes"}.`,
    });
  } else {
    confidence = "unverified";
    signals.push({
      rule: "employer_not_on_register",
      detail:
        "No exact match on the Home Office register — the employer may use a different legal name, or not sponsor at all.",
    });
  }

  /* --- 2. Salary / new entrant ----------------------------------- */

  const pay = input.salaryMax ?? input.salaryMin;
  if (pay && pay > 0 && pay < SKILLED_WORKER_GENERAL_THRESHOLD) {
    flags.push("new_entrant_salary");
    signals.push({
      rule: "below_general_threshold",
      detail: `Advertised up to £${Math.round(pay).toLocaleString(
        "en-GB",
      )}, under the £${SKILLED_WORKER_GENERAL_THRESHOLD.toLocaleString(
        "en-GB",
      )} general threshold${
        pay >= SKILLED_WORKER_NEW_ENTRANT_THRESHOLD
          ? ` — meets the £${SKILLED_WORKER_NEW_ENTRANT_THRESHOLD.toLocaleString("en-GB")} new-entrant rate`
          : " and also under the new-entrant rate, so salary may need negotiating"
      }.`,
    });
  }

  const newEntrantMention = NEW_ENTRANT_MENTION.exec(haystack);
  if (newEntrantMention) {
    if (!flags.includes("new_entrant_salary")) flags.push("new_entrant_salary");
    signals.push({
      rule: "new_entrant_mentioned",
      detail: snippet(haystack, newEntrantMention.index, newEntrantMention[0].length),
    });
  }

  const phd = PHD_MENTION.exec(haystack);
  if (phd) {
    flags.push("phd_route");
    signals.push({
      rule: "phd_mentioned",
      detail: snippet(haystack, phd.index, phd[0].length),
    });
  }

  /* --- 3. Student / Graduate / HPI -------------------------------- */

  const studentMention = STUDENT_VISA_MENTION.exec(haystack);
  const earlyCareerScheme = STUDENT_GRADUATE_TYPES.has(jobType);

  if (studentMention) {
    flags.push("student_graduate_hpi");
    signals.push({
      rule: "student_visa_mentioned",
      detail: snippet(haystack, studentMention.index, studentMention[0].length),
    });
  } else if (earlyCareerScheme && (jobType === "internship" || jobType === "placement" || jobType === "insight")) {
    flags.push("student_graduate_hpi");
    signals.push({
      rule: "early_careers_scheme",
      detail:
        "Internship/placement/insight programmes are usually aimed at current students; sponsorship often follows a successful conversion to a permanent offer.",
    });
  }

  return {
    confidence,
    jobType,
    jobCategory,
    flags,
    signals: signals.slice(0, 6),
  };
}

/* ------------------------------------------------------------------ */
/* Presentation                                                        */
/* ------------------------------------------------------------------ */

export const CONFIDENCE_LABELS: Record<
  Confidence,
  { short: string; long: string; tone: "good" | "neutral" | "warn" | "bad" }
> = {
  apply_with_confidence: {
    short: "Apply with confidence",
    long: "The job ad or company policy states sponsorship is offered, or the posting scores high enough to make it very likely.",
    tone: "good",
  },
  application_recommended: {
    short: "Application recommended",
    long: "From an employer licensed by the Home Office. Sponsorship is not confirmed for this specific role.",
    tone: "neutral",
  },
  unverified: {
    short: "Unverified",
    long: "Employer not matched to the sponsor register. Check the ad before applying.",
    tone: "warn",
  },
  no_sponsorship: {
    short: "No sponsorship",
    long: "The ad appears to rule out visa sponsorship.",
    tone: "bad",
  },
};

export const FLAG_LABELS: Record<JobFlag, { short: string; long: string }> = {
  new_entrant_salary: {
    short: "New entrant / salary discount",
    long: "To be sponsored you would need to qualify as a new entrant (under 26, a recent graduate, or working towards a qualification) because the salary is below the general threshold. Check this at visa stage, not application stage.",
  },
  phd_route: {
    short: "PhD route",
    long: "The role or scheme refers to PhD/doctorate holders, who have a separate salary discount.",
  },
  student_graduate_hpi: {
    short: "Student / Graduate / HPI",
    long: "Aimed at current Student, Graduate, HPI or Global Talent visa holders. Some employers train you on your existing visa first, then sponsor you for a permanent role.",
  },
};
