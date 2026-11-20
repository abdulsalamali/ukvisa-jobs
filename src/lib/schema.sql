-- Home Office sponsor register: one row per (organisation, town, route).
CREATE TABLE IF NOT EXISTS sponsor_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_name TEXT NOT NULL,
  org_norm TEXT NOT NULL,
  town TEXT,
  county TEXT,
  rating TEXT,
  route TEXT,
  source_date TEXT
);

-- Register deduplicated to one row per organisation.
CREATE TABLE IF NOT EXISTS sponsors (
  slug TEXT PRIMARY KEY,
  org_name TEXT NOT NULL,
  org_norm TEXT NOT NULL,
  towns TEXT NOT NULL DEFAULT '[]',
  routes TEXT NOT NULL DEFAULT '[]',
  rating TEXT,
  town_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  company_norm TEXT NOT NULL,
  sponsor_slug TEXT,
  location TEXT,
  city TEXT,
  description TEXT,
  url TEXT NOT NULL,
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT,
  contract_type TEXT,
  remote INTEGER NOT NULL DEFAULT 0,
  posted_at TEXT,
  job_type TEXT NOT NULL DEFAULT 'unspecified',
  job_category TEXT NOT NULL DEFAULT 'unspecified',
  experience_years INTEGER,
  confidence TEXT NOT NULL DEFAULT 'unverified',
  flags TEXT NOT NULL DEFAULT '[]',
  signals TEXT NOT NULL DEFAULT '[]',
  relevance INTEGER NOT NULL DEFAULT 0,
  relevance_signals TEXT NOT NULL DEFAULT '[]',
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sponsor_rows_norm ON sponsor_rows (org_norm);
CREATE INDEX IF NOT EXISTS idx_sponsors_norm ON sponsors (org_norm);
CREATE INDEX IF NOT EXISTS idx_jobs_sponsor ON jobs (sponsor_slug);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs (company_norm);
CREATE INDEX IF NOT EXISTS idx_jobs_posted ON jobs (posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs (job_category, job_type);
CREATE INDEX IF NOT EXISTS idx_jobs_confidence ON jobs (confidence);
CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs (active);
CREATE INDEX IF NOT EXISTS idx_jobs_relevance ON jobs (relevance DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_city ON jobs (city);
