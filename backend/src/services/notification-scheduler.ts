// Etap 4 + bildirim modülü — in-process, singleton zamanlayıcı. Aynı desen:
// backend/src/services/trendyol/order-poller.ts. Artık SABİT KOD DEĞİL:
// notification_settings tablosundan (migration 0258) okur — aç/kapa, kişi-bazlı
// alıcılar, zamanlama, metin şablonu ve sessiz saatler.
//
// Push YAPILANDIRILMAMIŞSA (VAPID yok) zamanlayıcı hiç BAŞLAMAZ.

import { pool } from "../db/connection.js";
import { env } from "../config/env.js";
import { sendToUser, type PushPayload } from "./push.service.js";
import {
  loadNotificationConfig,
  resolveActiveRecipients,
  renderTemplate,
  isWithinQuietHours,
  type LoadedNotificationConfig,
} from "./notification-settings.service.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

// Tek alıcıya push göndermeyi dener; hatayı yutar+loglar (VAPID yoksa
// PUSH_NOT_CONFIGURED dahil) — bir alıcının hatası diğerini engellemesin.
async function trySend(userId: string, payload: PushPayload, ctx: string): Promise<void> {
  try {
    await sendToUser(userId, payload);
  } catch (err) {
    console.error(`[notif-scheduler] ${ctx} push hatası (user=${userId}):`, err instanceof Error ? err.message : err);
  }
}

type ReminderCandidate = {
  id: string;
  instructor_id: string;
  student_full_name: string;
  starts_at: string;
  minutes_remaining: string;
};

// ─── Ders hatırlatma yuvası (erken/geç) ─────────────────────────────────────
// early → reminder_30_sent_at, late → reminder_10_sent_at kolonu (dakikalar
// config'ten gelir; kolon adı tarihsel). suppressIfBusy açıksa, eşik anında
// (starts_at - dakika) eğitmenin başka scheduled dersi sürüyorsa gönderim
// atlanır ama damga yine basılır (tekrar değerlendirilmesin).
async function runReminderSlot(which: "early" | "late", preloaded?: LoadedNotificationConfig): Promise<void> {
  try {
    const cfg = preloaded ?? (await loadNotificationConfig());
    const lr = cfg.lessonReminder;
    if (!lr.enabled) return;
    const s = which === "early" ? lr.early : lr.late;
    if (!s.enabled) return;
    const col = which === "early" ? "reminder_30_sent_at" : "reminder_10_sent_at";

    const { rows: candidates } = await pool.query<ReminderCandidate>(
      `SELECT
          l.id, l.instructor_id, st.full_name AS student_full_name, l.starts_at,
          EXTRACT(EPOCH FROM (l.starts_at - now())) / 60 AS minutes_remaining
         FROM lessons l
         JOIN students st ON st.id = l.student_id
        WHERE l.status = 'scheduled'
          AND l.deleted_at IS NULL
          AND l.${col} IS NULL
          AND l.starts_at <= now() + ($1 * interval '1 minute')
          AND l.starts_at > now()`,
      [s.minutes],
    );
    if (candidates.length === 0) return;

    const recipients = await resolveActiveRecipients(lr.recipients);

    for (const c of candidates) {
      const claim = await pool.query<{ id: string }>(
        `UPDATE lessons SET ${col} = now() WHERE id = $1 AND ${col} IS NULL RETURNING id`,
        [c.id],
      );
      if (claim.rowCount === 0) continue; // başka bir tick zaten aldı

      if (s.suppressIfBusy) {
        // Art arda ders bastırması: bu dersin (starts_at - dakika) anında AYNI
        // eğitmenin BAŞKA bir scheduled dersi hâlâ sürüyor mu? (lessons.service.ts
        // çakışma sorgusuyla aynı interval idiomu.)
        const overlap = await pool.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM lessons
              WHERE instructor_id = $1
                AND id <> $2
                AND status = 'scheduled'
                AND deleted_at IS NULL
                AND starts_at <= ($3::timestamptz - ($4 * interval '1 minute'))
                AND (starts_at + duration_minutes * INTERVAL '1 minute') > ($3::timestamptz - ($4 * interval '1 minute'))
           ) AS exists`,
          [c.instructor_id, c.id, c.starts_at, s.minutes],
        );
        if (overlap.rows[0].exists) continue; // bastırıldı — damga zaten basılı
      }

      if (recipients.length === 0) continue;
      const minutesRemaining = Math.max(0, Math.round(Number(c.minutes_remaining)));
      const vars = { student: c.student_full_name, minutes: minutesRemaining };
      const payload: PushPayload = {
        title: renderTemplate(lr.titleTemplate, vars),
        body: renderTemplate(lr.bodyTemplate, vars),
        url: "/",
      };
      for (const userId of recipients) {
        await trySend(userId, payload, `ders hatırlatma (${which})`);
      }
    }
  } catch (err) {
    console.error(`[notif-scheduler] ders hatırlatma (${which}) hatası:`, err instanceof Error ? err.message : err);
  }
}

// Geriye dönük export adları (smoke 37 doğrudan çağırır): 30dk = erken yuva,
// 10dk = geç yuva (varsayılan dakikalar; config değiştirilebilir).
export async function check30MinReminders(preloaded?: LoadedNotificationConfig): Promise<void> {
  return runReminderSlot("early", preloaded);
}
export async function check10MinReminders(preloaded?: LoadedNotificationConfig): Promise<void> {
  return runReminderSlot("late", preloaded);
}

type StaleLessonCandidate = {
  id: string;
  student_full_name: string;
  starts_at: string;
};

// ─── Bayat/onaylanmamış ders durumu dürtmesi (tek seferlik) ────────────────
export async function checkStaleLessonStatus(preloaded?: LoadedNotificationConfig): Promise<void> {
  try {
    const cfg = preloaded ?? (await loadNotificationConfig());
    const st = cfg.staleLesson;
    if (!st.enabled) return;

    const { rows: candidates } = await pool.query<StaleLessonCandidate>(
      `SELECT l.id, s.full_name AS student_full_name, l.starts_at
         FROM lessons l
         JOIN students s ON s.id = l.student_id
        WHERE l.status = 'scheduled'
          AND l.deleted_at IS NULL
          AND l.status_nudge_sent_at IS NULL
          AND l.starts_at <= now() - ($1 * interval '1 minute')`,
      [st.thresholdMinutes],
    );
    if (candidates.length === 0) return;

    const recipients = await resolveActiveRecipients(st.recipients);

    for (const c of candidates) {
      const claim = await pool.query<{ id: string }>(
        `UPDATE lessons SET status_nudge_sent_at = now()
          WHERE id = $1 AND status_nudge_sent_at IS NULL
          RETURNING id`,
        [c.id],
      );
      if (claim.rowCount === 0) continue;

      if (recipients.length === 0) continue;
      const hhmm = new Date(c.starts_at).toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: env.timeZone,
      });
      const vars = { student: c.student_full_name, time: hhmm };
      const payload: PushPayload = {
        title: renderTemplate(st.titleTemplate, vars),
        body: renderTemplate(st.bodyTemplate, vars),
        url: "/",
      };
      for (const userId of recipients) {
        await trySend(userId, payload, "durum dürtmesi");
      }
    }
  } catch (err) {
    console.error("[notif-scheduler] durum dürtmesi hatası:", err instanceof Error ? err.message : err);
  }
}

// ─── Yeni Trendyol siparişi (sipariş bazlı dedup, satır bazlı değil) ───────
// Kaynak channel_order_sightings (migration 0259/0260) — salt-okunur sipariş
// listesi akışından (orders.service.ts, marketplace_sync_enabled) beslenir.
// BİLEREK channel_order_lines KULLANILMIYOR: o yalnız stok senkronu
// (marketplace_orders_enabled, varsayılan kapalı + UI'dan gizli) açıkken dolar —
// ona bağlı kalsaydı stok fazı kapalıyken "yeni sipariş" bildirimi hiç tetiklenmezdi.
//
// order_date (siparişin GERÇEK Trendyol tarihi) filtrelenir — first_seen_at
// (bizim ne zaman gördüğümüz) DEĞİL. İlk sürümde first_seen_at kullanılmıştı ve
// tablo ilk dolduğunda (veya ileride geniş/eski bir pencere ilk kez çekildiğinde)
// TÜM geçmiş siparişler tek seferde "yeni" sayılıp gerçek kullanıcılara bildirim
// denendi — bu olaydan sonra düzeltildi (bkz. 0260 migration notu).
export async function checkNewChannelOrders(preloaded?: LoadedNotificationConfig): Promise<void> {
  try {
    const cfg = preloaded ?? (await loadNotificationConfig());
    const no = cfg.newOrder;
    if (!no.enabled) return;

    // Atomik claim: yalnız DAHA ÖNCE notified_channel_orders'ta olmayan
    // (channel, order_number) çiftleri INSERT edilir ve RETURNING ile geri
    // gelir — tam olarak "yeni bildirilecek sipariş" kümesi, race-safe.
    // order_date IS NULL olan satırlar (nadir/savunma) asla claim edilmez —
    // gerçekten yeni olduğu doğrulanamayan bir siparişi bildirmemek, yanlışlıkla
    // eskiyi bildirmekten daha güvenli.
    const { rows: claimed } = await pool.query<{ channel: string; order_number: string }>(
      `INSERT INTO notified_channel_orders (channel, order_number)
       SELECT DISTINCT channel, order_number
         FROM channel_order_sightings
        WHERE channel = 'trendyol'
          AND order_date > now() - interval '1 day'
       ON CONFLICT (channel, order_number) DO NOTHING
       RETURNING channel, order_number`,
    );
    if (claimed.length === 0) return;

    const recipients = await resolveActiveRecipients(no.recipients);
    if (recipients.length === 0) return;

    for (const { channel, order_number } of claimed) {
      const detail = await pool.query<{ customer_name: string | null }>(
        `SELECT customer_name FROM channel_order_sightings WHERE channel = $1 AND order_number = $2`,
        [channel, order_number],
      );
      const customerName = detail.rows[0]?.customer_name ?? "Bilinmeyen müşteri";

      const vars = { customer: customerName, order: order_number };
      const payload: PushPayload = {
        title: renderTemplate(no.titleTemplate, vars),
        body: renderTemplate(no.bodyTemplate, vars),
        url: "/",
      };
      for (const userId of recipients) {
        await trySend(userId, payload, "yeni sipariş");
      }
    }
  } catch (err) {
    console.error("[notif-scheduler] yeni sipariş bildirimi hatası:", err instanceof Error ? err.message : err);
  }
}

async function tick(): Promise<void> {
  if (running) return; // önceki tick hâlâ sürüyor
  running = true;
  try {
    const cfg = await loadNotificationConfig();
    // Sessiz saatler: bu pencerede hiçbir şey gönderme/claim etme (ertelenir —
    // pencere bitince normal akış devam eder). Zamana bağlı hatırlatmalar
    // geçerse doğal olarak aday olmaktan çıkar (starts_at > now filtresi).
    if (cfg.quietHours.enabled && isWithinQuietHours(new Date(), cfg.quietHours.start, cfg.quietHours.end, env.timeZone)) {
      return;
    }
    await check30MinReminders(cfg);
    await check10MinReminders(cfg);
    await checkStaleLessonStatus(cfg);
    await checkNewChannelOrders(cfg);
  } catch (err) {
    console.error("[notif-scheduler] hata:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startNotificationScheduler(): void {
  if (timer) return; // zaten başladı
  const ms = env.notificationSchedulerMs;
  if (!ms || ms <= 0) {
    console.log("[notif-scheduler] devre dışı (NOTIFICATION_SCHEDULER_MS=0).");
    return;
  }
  if (!env.vapidPublicKey || !env.vapidPrivateKey) {
    console.log("[notif-scheduler] VAPID anahtarları yok; zamanlayıcı başlatılmadı.");
    return;
  }
  timer = setInterval(() => {
    void tick();
  }, ms);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[notif-scheduler] başladı (her ${Math.round(ms / 1000)}sn).`);
}

export function stopNotificationScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
