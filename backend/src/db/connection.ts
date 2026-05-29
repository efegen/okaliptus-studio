import { Pool } from "pg";

import { env } from "../config/env.js";

export const pool = new Pool({
  application_name: "yoga-studio-dashboard-backend",
  connectionString: env.databaseUrl,
  // TLS opt-in: DATABASE_SSL=true değilse davranış bugünküyle aynı kalır
  // (undefined → SSL kapalı, mevcut Railway bağlantısı kırılmaz).
  // true ise TLS devreye girer; Railway iç sertifikaları self-signed
  // olabildiği için rejectUnauthorized:false. DATABASE_URL içinde sslmode
  // varsa pg onu zaten onurlandırır.
  ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
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
