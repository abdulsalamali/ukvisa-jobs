import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { boardUrl, fetchAts, type AtsCompany } from "../sources/ats";
import { fetchWorkday, type WorkdayCompany } from "../sources/workday";
import { fetchPhenom, type PhenomCompany } from "../sources/phenom";
import { robotsAllows } from "../lib/robots";
import { fetchAdzuna, fetchReed } from "../sources/aggregators";

/**
 * Verifies every configured source. Run this after adding API keys, or when a
 * company's board suddenly returns nothing.
 */

function loadEnv(): void {
  const file = path.join(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}

async function httpStatus(url: string, headers: Record<string, string> = {}): Promise<number> {
  try {
    const res = await fetch(url, { headers });
    return res.status;
  } catch {
    return 0;
  }
}

function row(label: string, state: string, detail: string): void {
  console.log(`${label.padEnd(22)} ${state.padEnd(10)} ${detail}`);
}

async function main(): Promise<void> {
  loadEnv();
  let failures = 0;

  console.log("\nAPI sources\n");
  const hasAdzuna = Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
  if (!hasAdzuna) {
    row("Adzuna", "not set", "add ADZUNA_APP_ID + ADZUNA_APP_KEY to .env");
  } else {
    const jobs = await fetchAdzuna();
    row("Adzuna", jobs.length ? "ok" : "empty", `${jobs.length} UK jobs returned`);
    if (!jobs.length) failures += 1;
  }

  const hasReed = Boolean(process.env.REED_API_KEY);
  if (!hasReed) {
    row("Reed", "not set", "add REED_API_KEY to .env");
  } else {
    const jobs = await fetchReed();
    row("Reed", jobs.length ? "ok" : "empty", `${jobs.length} UK jobs returned`);
    if (!jobs.length) failures += 1;
  }

  console.log("\nEmployer boards\n");
  const companies: AtsCompany[] = JSON.parse(
    readFileSync(path.join(process.cwd(), "config/ats-companies.json"), "utf8"),
  );

  const results = await Promise.all(
    companies.map(async (company) => {
      const url = boardUrl(company);
      const code = await httpStatus(url, {
        "user-agent": "ukvisa-jobs/0.1 (personal job board)",
      });
      if (code !== 200) {
        return { company, code, jobs: 0, ok: false };
      }
      const jobs = await fetchAts(company);
      return { company, code, jobs: jobs.length, ok: true };
    }),
  );

  for (const result of results) {
    const label = `${result.company.name ?? result.company.slug} (${result.company.kind})`;
    if (!result.ok) {
      failures += 1;
      row(label, `HTTP ${result.code}`, "slug is wrong or the board moved");
    } else if (result.jobs === 0) {
      row(label, "ok", "0 open roles");
    } else {
      row(label, "ok", `${result.jobs} roles`);
    }
  }

  const total = results.reduce((sum, result) => sum + result.jobs, 0);
  console.log(`\n${results.length} boards, ${total} roles fetched.`);

  const phenomFile = path.join(process.cwd(), "config/phenom-companies.json");
  const phenomCompanies: PhenomCompany[] = existsSync(phenomFile)
    ? JSON.parse(readFileSync(phenomFile, "utf8"))
    : [];

  if (phenomCompanies.length > 0) {
    console.log("\nPhenom sites\n");
    for (const company of phenomCompanies) {
      const jobs = await fetchPhenom(company);
      if (jobs.length === 0) {
        row(`${company.name} (phenom)`, "empty", "page reached but no embedded jobs parsed");
        failures += 1;
      } else {
        row(`${company.name} (phenom)`, "ok", `${jobs.length} roles`);
      }
    }
  }

  const workdayFile = path.join(process.cwd(), "config/workday-companies.json");
  const workdayCompanies: WorkdayCompany[] = existsSync(workdayFile)
    ? JSON.parse(readFileSync(workdayFile, "utf8"))
    : [];

  if (workdayCompanies.length > 0) {
    console.log("\nWorkday sites\n");
    for (const company of workdayCompanies) {
      const allowed = await robotsAllows(company.host, `/${company.site}/`);
      if (!allowed) {
        failures += 1;
        row(`${company.name} (workday)`, "disallowed", "robots.txt blocks this path — skipped");
        continue;
      }
      const jobs = await fetchWorkday(company);
      if (jobs.length === 0) {
        row(`${company.name} (workday)`, "empty", "site reachable but returned no roles");
      } else {
        row(`${company.name} (workday)`, "ok", `${jobs.length} roles`);
      }
    }
  }

  if (failures > 0) {
    console.log(`${failures} source(s) need attention.`);
    process.exit(1);
  }
  console.log("All configured sources are healthy.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
