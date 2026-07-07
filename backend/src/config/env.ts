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

  // Web Push (PWA bildirimleri) — yalnız test amaçlı, owner rolüne kilitli
  // (requireCan("push.test")). Anahtarlar yoksa özellik tamamen kapalı.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:you@example.com",

  // Trendyol Marketplace (yalnız sipariş OKUMA, read-only). Anahtarlar yoksa
  // özellik kapalı kalır (preview ucu "yapılandırılmamış" hatası döner).
  // Base URL PROD'a sabit DEĞİL; STAGE'e geçmek için env ile override edilir.
  // Collection STAGE; biz PROD + read-only kullanıyoruz, demo token hardcode YOK.
  trendyolApiBaseUrl: (process.env.TRENDYOL_API_BASE_URL ?? "https://apigw.trendyol.com").trim().replace(/\/+$/, ""),
  trendyolSellerId: (process.env.TRENDYOL_SELLER_ID ?? "").trim(),
  trendyolApiKey: (process.env.TRENDYOL_API_KEY ?? "").trim(),
  trendyolApiSecret: (process.env.TRENDYOL_API_SECRET ?? "").trim(),

  // Model C / Faz 1 sipariş poller'ı. 0 → poller hiç başlamaz (manuel uç yine
  // çalışır). Pencere TY'nin ~2 haftalık sipariş aralığı kısıtına uyar (≤14 gün).
  trendyolOrderPollMs: Math.max(0, Number.parseInt(process.env.TRENDYOL_ORDER_POLL_MS ?? "180000", 10) || 0),
  trendyolOrderWindowDays: Math.min(14, Math.max(1, Number.parseInt(process.env.TRENDYOL_ORDER_WINDOW_DAYS ?? "14", 10) || 14)),

  // İade (claims) penceresi: claimDate'e göre süzülür (orders'tan AYRI, 2 hafta
  // sınırı YOK — PROD'da doğrulandı). İadeler siparişten haftalar sonra açılabildiği
  // için orders penceresinden geniştir; her tick yeniden görülür (idempotent).
  trendyolClaimWindowDays: Math.min(180, Math.max(1, Number.parseInt(process.env.TRENDYOL_CLAIM_WINDOW_DAYS ?? "60", 10) || 60)),

  // Etap 4 — bildirim zamanlayıcısı (ders hatırlatma + durum dürtmesi + yeni
  // sipariş). 0 → zamanlayıcı hiç başlamaz. VAPID anahtarları yoksa da başlamaz
  // (bkz. notification-scheduler.ts).
  notificationSchedulerMs: Math.max(0, Number.parseInt(process.env.NOTIFICATION_SCHEDULER_MS ?? "60000", 10) || 0),
} as const;
