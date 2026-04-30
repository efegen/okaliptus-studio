import { config } from "dotenv";

config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const PORT = Number.parseInt(process.env.PORT ?? "4000", 10);

if (Number.isNaN(PORT) || PORT <= 0) {
  throw new Error("PORT must be a positive integer.");
}

export const env = {
  databaseUrl: DATABASE_URL,
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: PORT,
  timeZone: process.env.TZ ?? "Europe/Istanbul",
} as const;
