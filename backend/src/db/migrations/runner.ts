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

async function assertMigrationPreconditions(client: PoolClient, filename: string): Promise<void> {
  // 0267 eski `not_coming` satırlarını CASCADE ile fiziksel siliyor. Migration
  // dosyasını geçmiş sözleşme gereği değiştirmiyoruz; fakat otomatik production
  // migrate'ın sessiz veri kaybıyla ilerlemesine de izin vermiyoruz.
  if (filename === "0267_event_rsvp_remove_not_coming.sql") {
    await client.query("LOCK TABLE event_participants IN SHARE ROW EXCLUSIVE MODE");
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM event_participants
        WHERE rsvp_status = 'not_coming'`,
    );
    const count = Number(result.rows[0]?.count ?? 0);
    if (count > 0) {
      throw new Error(
        `Migration ${filename} durduruldu: ${count} not_coming katılımcı silinecekti. `
        + "Önce yedek alın ve kayıtları iş kararıyla taşıyın.",
      );
    }
  }
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
        await assertMigrationPreconditions(client, filename);
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
