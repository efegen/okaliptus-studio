import webpush from "web-push";

import { pool } from "../db/connection.js";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

// VAPID detayları yalnız bir kez set edilir. Anahtarlar yoksa configure edilmez
// ve sendToUser açıkça hata fırlatır (sessizce "gönderdim" demez).
let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!env.vapidPublicKey || !env.vapidPrivateKey) return false;
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  configured = true;
  return true;
}

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

export async function saveSubscription(
  userId: string,
  sub: PushSubscriptionInput,
  userAgent: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id      = EXCLUDED.user_id,
           p256dh       = EXCLUDED.p256dh,
           auth         = EXCLUDED.auth,
           user_agent   = EXCLUDED.user_agent,
           last_seen_at = now()`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent],
  );
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await pool.query(
    `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
    [userId, endpoint],
  );
}

// İZOLASYON GARANTİSİ: yalnız verilen userId'nin abonelik satırlarını sorgular ve
// yalnız onlara gönderir. Başka kullanıcının endpoint'ine asla dokunmaz. Ölü
// endpoint'leri (404/410) yalnız o satır bazında temizler. Gönderilen cihaz
// sayısını döner.
export async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) {
    throw new AppError(
      "PUSH_NOT_CONFIGURED",
      "VAPID anahtarları yapılandırılmamış. Sunucuda VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY tanımlanmalı.",
      503,
    );
  }

  const { rows } = await pool.query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId],
  );

  const body = JSON.stringify(payload);
  let sent = 0;

  for (const row of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        body,
      );
      sent += 1;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      // 404/410 → abonelik artık geçersiz (izin geri alınmış / cihaz değişmiş).
      // Yalnız bu kullanıcıya ait ölü endpoint silinir.
      if (statusCode === 404 || statusCode === 410) {
        await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [row.endpoint]);
      } else {
        console.error("[push] sendNotification failed:", statusCode, (err as Error).message);
      }
    }
  }

  return sent;
}
