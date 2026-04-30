import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { PoolClient } from "pg";

import { pool } from "../connection.js";

const MIGRATIONS_TABLE = "schema_migrations";
const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

type AppliedMigration = {
  filename: string;
};

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id bigserial PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      executed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<AppliedMigration>(
    `SELECT filename FROM ${MIGRATIONS_TABLE} ORDER BY filename ASC`,
  );

  return new Set(result.rows.map((row) => row.filename));
}

async function getMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function runMigrations(): Promise<string[]> {
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);

    const appliedMigrations = await getAppliedMigrations(client);
    const migrationFiles = await getMigrationFiles();
    const executedMigrations: string[] = [];

    for (const filename of migrationFiles) {
      if (appliedMigrations.has(filename)) {
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, filename), "utf8");

      await client.query("BEGIN");

      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1)`,
          [filename],
        );
        await client.query("COMMIT");
        executedMigrations.push(filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return executedMigrations;
  } finally {
    client.release();
  }
}
