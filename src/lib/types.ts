export type Confidence =
  | "apply_with_confidence"
  | "application_recommended"
  | "unverified"
  | "no_sponsorship";

export type JobType =
  | "graduate"
  | "internship"
  | "placement"
  | "insight"
  | "entry_level"
  | "associate"
  | "mid_senior"
  | "director"
  | "unspecified";

export type JobCategory = "student_graduate" | "experienced_hire" | "unspecified";

export type JobFlag = "new_entrant_salary" | "phd_route" | "student_graduate_hpi";

/** One piece of evidence behind a label. Rendered in the UI so nothing is a black box. */
export interface Signal {
  rule: string;
  detail: string;
}

export interface SponsorRef {
  slug: string;
  orgName: string;
  rating: string | null;
  routes: string[];
}

export interface RawJob {
  id: string;
  source: string;
  title: string;
  companyName: string;
  location: string | null;
  description: string | null;
  url: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  contractType: string | null;
  remote: boolean;
  postedAt: string | null;
}

export interface Job extends RawJob {
  companyNorm: string;
  sponsorSlug: string | null;
  jobType: JobType;
  jobCategory: JobCategory;
  confidence: Confidence;
  flags: JobFlag[];
  signals: Signal[];
  firstSeen: string;
  lastSeen: string;
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
