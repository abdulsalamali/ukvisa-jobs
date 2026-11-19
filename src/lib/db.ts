import { createClient, type Client } from "@libsql/client";
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let cached: Client | null = null;

export function databaseUrl(): string {
  return process.env.TURSO_DATABASE_URL ?? "file:data/jobs.db";
}

/**
 * Serverless platforms ship the filesystem read-only, and SQLite needs to
 * create a journal next to the database. If the directory is not writable,
 * copy the file to the temp directory once and open it from there.
 */
function resolveRuntimeUrl(url: string): string {
  if (!url.startsWith("file:")) return url;

  const filePath = url.slice("file:".length);
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

  if (!existsSync(absolute)) return url;

  try {
    accessSync(path.dirname(absolute), constants.W_OK);
    return url;
  } catch {
    const temporary = path.join(tmpdir(), "sponsorboard.db");
    try {
      if (!existsSync(temporary)) copyFileSync(absolute, temporary);
      return `file:${temporary}`;
    } catch (error) {
      console.error("[db] could not open database:", (error as Error).message);
      return url;
    }
  }
}

export function db(): Client {
  if (!cached) {
    const url = resolveRuntimeUrl(databaseUrl());
    cached = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
  }
  return cached;
}

/** Applies schema.sql. Safe to run repeatedly. */
export async function migrate(client: Client): Promise<void> {
  const sql = readFileSync(path.join(process.cwd(), "src/lib/schema.sql"), "utf8");
  const statements = sql
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean);

  // Tables first, then additive column migrations, then indexes — an index on
  // a column added by migration would fail if it ran before ensureColumns.
  for (const statement of statements.filter((s) => /^CREATE TABLE/i.test(s))) {
    await client.execute(statement);
  }
  await ensureColumns(client);
  for (const statement of statements.filter((s) => /^CREATE INDEX/i.test(s))) {
    await client.execute(statement);
  }
}

/**
 * CREATE TABLE IF NOT EXISTS won't add columns to a database created by an
 * older version of the schema, so additive changes are applied here.
 */
async function ensureColumns(client: Client): Promise<void> {
  const additions: [table: string, column: string, definition: string][] = [
    ["jobs", "relevance", "INTEGER NOT NULL DEFAULT 0"],
    ["jobs", "relevance_signals", "TEXT NOT NULL DEFAULT '[]'"],
    ["jobs", "city", "TEXT"],
  ];

  for (const [table, column, definition] of additions) {
    const info = await client.execute(`PRAGMA table_info(${table})`);
    const existing = new Set(info.rows.map((row) => String(row.name)));
    if (!existing.has(column)) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

export async function getMeta(key: string): Promise<string | null> {
  const res = await db().execute({
    sql: "SELECT value FROM meta WHERE key = ?",
    args: [key],
  });
  return (res.rows[0]?.value as string) ?? null;
}

export async function setMeta(client: Client, key: string, value: string): Promise<void> {
  await client.execute({
    sql: "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, value],
  });
}
