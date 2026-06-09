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

// TLS/SSL opt-in. Kullanıcı Railway'de TLS'i doğruladıktan sonra
// DATABASE_SSL=true set etmeli; yanlışlıkla zorlamak mevcut bağlantıyı
// kırıp outage yaratabileceği için opt-in (açık-rıza) bırakıldı.
const databaseSsl = process.env.DATABASE_SSL === "true";

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
  databaseSsl,
  nodeEnv: NODE_ENV,
  port: PORT,
  timeZone: process.env.TZ ?? "Europe/Istanbul",
  allowedOrigins,

  // Web Push (PWA bildirimleri) — yalnız test amaçlı. Anahtarlar yoksa özellik
  // kapalı kalır. pushTestUsername boş ise /push/* uçları herkese 403 döner.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:froxefe@gmail.com",
  pushTestUsername: (process.env.PUSH_TEST_USERNAME ?? "").trim(),
} as const;
