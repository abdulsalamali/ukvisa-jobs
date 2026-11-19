import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import path from "node:path";

let cached: Client | null = null;

export function databaseUrl(): string {
  return process.env.TURSO_DATABASE_URL ?? "file:data/jobs.db";
}

export function db(): Client {
  if (!cached) {
    cached = createClient({
      url: databaseUrl(),
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
