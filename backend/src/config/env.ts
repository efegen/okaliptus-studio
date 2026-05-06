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

const NODE_ENV = process.env.NODE_ENV ?? "development";

const ALLOWED_ORIGINS_RAW = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Production must whitelist origins explicitly. Dev falls back to the Vite
// default ports so local work doesn't need ALLOWED_ORIGINS set.
const allowedOrigins =
  ALLOWED_ORIGINS_RAW.length > 0
    ? ALLOWED_ORIGINS_RAW
    : NODE_ENV === "production"
      ? []
      : ["http://localhost:5173", "http://127.0.0.1:5173"];

export const env = {
  databaseUrl: DATABASE_URL,
  nodeEnv: NODE_ENV,
  port: PORT,
  timeZone: process.env.TZ ?? "Europe/Istanbul",
  allowedOrigins,
} as const;
