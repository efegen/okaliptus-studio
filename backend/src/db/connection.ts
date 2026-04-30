import { Pool } from "pg";

import { env } from "../config/env.js";

export const pool = new Pool({
  application_name: "yoga-studio-dashboard-backend",
  connectionString: env.databaseUrl,
});

export async function verifyDatabaseConnection(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}

export async function closeDatabaseConnection(): Promise<void> {
  await pool.end();
}
