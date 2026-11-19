# SponsorBoard

A personal job board for UK vacancies at employers licensed to sponsor visas.
It joins the Home Office sponsor register with live job feeds, then classifies
and scores every listing against your own profile and CV.

Built because the commercial equivalents charge for data that is mostly free.

---

## What it does

| Feature | How it works |
| --- | --- |
| Sponsor directory | 126k+ organisations parsed from the daily Home Office CSV (OGL v3) |
| Live jobs | Employer ATS feeds (Greenhouse, Lever, Ashby) + Adzuna/Reed free tiers |
| Employer → register matching | Normalised legal name, compact name, and `t/a` trading names |
| Sponsorship labels | Rule-based, with the matching sentence stored as evidence |
| Job type taxonomy | Graduate / Internship / Placement / Insight / Entry / Associate / Mid-Senior / Director |
| Personal scoring | Field weights + your skills + CV overlap + location + seniority fit |
| Salary / new-entrant flags | Advertised pay compared against configurable thresholds |

Every label and score is explainable: the UI shows the sentence or rule that
produced it. Nothing is an opaque "AI score".

---

## Quick start

```bash
cd ukvisa-jobs
npm install
cp .env.example .env

npm run ingest          # register + jobs
npm run dev             # http://localhost:3000
```

`npm run ingest:sponsors` refreshes only the register (~10 MB download,
126k rows, a few seconds). `npm run ingest:jobs` refreshes only listings.

---

## Making it yours

### `config/profile.json`

- `fields` — what you are targeting. Order does not matter; `weight` (0–1)
  does. A cyber field at `1` beats a software field at `0.4`.
- `exclude` — phrases that cancel a match. This is what stops "security guard"
  matching a cyber role.
- `skills` — technologies you can claim. Each one that appears in an ad adds
  points.
- `locations` — weighted. London at 12 beats Coventry at 8; anything else in
  the UK still scores `locationBaseline`.
- `seniorityTarget` — set to `early` to penalise Director/Mid-Senior roles
  that would be a stretch.
- `visa` — used to show a reminder and to surface "no sponsorship" jobs as
  still-applyable while your current visa is valid.

### `config/cv.md`

Paste your CV as plain text. The ingester extracts the phrases that repeat
across it (one- and two-word), and job ads get a bonus when they overlap.
`config/cv.md` is gitignored — keep it that way.

### `config/ats-companies.json`

Add employers whose job boards you want pulled directly. Find the slug from
their careers URL:

- `boards.greenhouse.io/<slug>` → `{ "kind": "greenhouse", "slug": "<slug>" }`
- `jobs.lever.co/<slug>` → `{ "kind": "lever", "slug": "<slug>" }`
- `jobs.ashbyhq.com/<slug>` → `{ "kind": "ashby", "slug": "<slug>" }`

Invalid slugs return 404 and are skipped, so it is safe to guess and re-run.

27 boards are seeded (fintech, cyber vendors, and remote-first tech). Two
caveats worth knowing:

- The largest graduate recruiters — Deloitte, PwC, KPMG, EY, the big banks and
  the civil service — run Workday or in-house portals with no public feed. They
  cannot be pulled this way, and scraping them is not worth the breakage.
- Global companies list mostly non-UK roles. These are filtered out at ingest
  (`looksUk`), so a board with 800 roles may add only 20 UK ones — which is
  the correct behaviour, not a bug.

### `config/workday-companies.json`

Employers whose careers site runs on Workday. Workday publishes the same JSON
endpoint its own page uses, and most tenants allow crawlers in `robots.txt`
(Barclays publishes a sitemap and `Allow: /External_Career_Site_Barclays/`).

```json
{
  "name": "Barclays",
  "host": "barclays.wd3.myworkdayjobs.com",
  "site": "External_Career_Site_Barclays",
  "searchTerms": ["cyber", "security", "risk", "graduate"],
  "maxJobs": 120
}
```

To find a tenant: open the employer's careers page and look at the
`*.myworkdayjobs.com` hostname and the path segment after it. The adapter
checks `robots.txt` before crawling, backs off on HTTP 429, and stores title,
location, URL and posting date only — it does not mirror ad text.

`searchTerms` matters: Workday rate-limits deep pagination, so a handful of
keyword searches reaches relevant roles with far fewer requests than paging
the whole board.

Not every big employer is Workday. `config/phenom-companies.json` covers
Phenom People careers sites, which server-render their result set into the page
(`phApp.ddo`). PwC UK is configured there:

```json
{
  "name": "PwC",
  "base": "https://jobs.pwc.co.uk",
  "path": "/uk/en",
  "searchTerms": ["cyber", "security", "risk", "graduate", "internship", "placement"]
}
```

Search terms matter here too: PwC's cyber roles are mostly experienced hires,
while the graduate schemes sit behind `graduate`, `internship` and `placement`.
The adapter stores the employer's own teaser text rather than mirroring ads.

Deloitte and KPMG UK did not expose a Workday or Phenom host that could be
verified (their careers sites redirect elsewhere), so they are not included.
Finding a working host is a manual step per employer.

### Finding boards automatically

```bash
npm run discover -- --limit=200          # probe a slice, report only
npm run discover -- --query=Monzo        # check one employer
npm run discover -- --query=Monzo --merge  # append verified boards to config
```

It generates slug candidates from the legal and trading names, probes
Greenhouse, Lever, Ashby, Workable and SmartRecruiters, and keeps a board only
when **the provider reports a matching company name** *and* **the board
advertises at least one UK role**.

Both gates matter. Without them:

- "Infuse Consulting Limited" matched a Singapore company called INFUSE with 272
  non-UK jobs.
- "Elastic Path Software (UK) Ltd" matched Elastic NV's board.
- "ABC Education Consultancy" matched a board with the slug `abc`.

Measured yield: **0 verified boards from a 200-sponsor tech slice**, against
1/1 for a known employer (Monzo, 52 UK roles). Slug guessing is a long tail,
not a shortcut — scope it with `--query` or `--city`, and treat merges as
something to eyeball rather than trust in bulk. Aggregator keys remain the
real lever for breadth.

### Verifying sources

```bash
npm run check:sources
```

Prints one line per source with its HTTP status and role count, and exits
non-zero if anything is broken. Run it after adding a company or an API key.

### `config/aliases.json`

Only needed when the ad uses a name that is neither the legal name nor the
`t/a` trading name on the register:

```json
{ "monzo": "monzo bank" }
```

---

## How the labels are decided

**Confidence** (first rule that matches wins):

1. `no_sponsorship` — an explicit refusal ("we are unable to offer visa
   sponsorship", "no sponsorship available", "must already have the right to
   work").
2. `apply_with_confidence` — a positive statement ("we sponsor visas",
   "visa sponsorship available", "certificate of sponsorship").
3. `application_recommended` — no statement either way, but the employer is on
   the register.
4. `unverified` — employer not matched to the register.

**Flags** are independent of confidence:

- `new_entrant_salary` — advertised max pay is below the general threshold, or
  the ad mentions new entrants.
- `phd_route` — the ad refers to PhD/doctorate holders.
- `student_graduate_hpi` — internships/placements/insight programmes, or ads
  referencing Student/Graduate/HPI visas.

Thresholds live in `src/config/settings.ts`. **Verify them on GOV.UK** — the
UK changed the Skilled Worker salary floors in July 2025 and will change them
again.

**Relevance (0–100)** = field match (title 30, body 12, × field weight)
+ skills (max 20) + CV overlap (max 20) + location (weighted) + sponsorship
(8/4) + recency (6) + early-careers bonus (5) − seniority penalty (18/28).

---

## Deployment (GitHub Pages, free)

The site is a static export. Pages serves the files; GitHub Actions rebuilds
them on a schedule.

1. **Make the repository public** (Pages from a private repo needs a paid plan).
   Nothing personal is committed: `config/cv.md` and `config/profile.local.json`
   are gitignored.
2. **Settings → Pages → Source: GitHub Actions.**
3. Push to `main`, or run the *Build and deploy* workflow manually.

Every run: `npm run ingest` → `npm run build:static` → upload `out/`. The cron
is 18:10 UTC daily, so jobs are up to a day old. Narrow it to every few hours
if you prefer fresher data.

### Optional secrets

| Secret | Effect |
|---|---|
| `CV_TEXT` | Written to `config/cv.md` before the build, so the deployed board scores against your real CV while the file stays out of the repo. |
| `PROFILE_LOCAL_JSON` | Overrides in `config/profile.local.json`, e.g. visa status. **Anything here appears on the public site.** |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `REED_API_KEY` | Extra job sources. |

Without `CV_TEXT` the build still works — scoring falls back to the skills
listed in `config/profile.json`.

---

## Data sources and their terms

- **Home Office register** — Open Government Licence v3.0. Attribution is
  required and included in the footer. Free for commercial use.
- **Adzuna** — free developer tier; check their attribution and caching terms.
- **Reed** — free API key; attribution required.
- **Greenhouse / Lever / Ashby public boards** — no key. These are public job
  boards intended to be read by aggregators, but check each provider's terms
  before making the site public.
- **No scraping of LinkedIn, Indeed or ukvisajobs.com.** It breaks their terms,
  breaks constantly, and is not needed: the underlying data is public.

---

## Known limits

- Coverage is only as good as the employers you add. Start with the ones you
  actually want to work for.
- Employer matching is deliberately conservative. A missed match shows
  "Unverified"; a wrong match would falsely claim sponsorship, which is worse.
  Use `config/aliases.json` to fix misses.
- Salary is only present when the employer publishes it.
- Job type classification is title-based. "Analyst" roles default to Entry
  Level; override per employer if that is wrong.
- This is information, not immigration advice.
