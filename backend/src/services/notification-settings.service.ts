// Panelden ayarlanabilir bildirim modülü — config okuma/yazma + scheduler'ın
// kullandığı yardımcılar (şablon render, sessiz saat kontrolü, alıcı çözümleme,
// test gönderimi). Kaynak tablo: notification_settings (migration 0258).
//
// Tasarım: alıcılar KİŞİ bazlı (recipient_user_ids). Her tür için enabled +
// alıcı + config (zamanlama + metin şablonu). '_global' satırı sessiz saatleri
// tutar (enabled = açık mı, config = {quietHoursStart, quietHoursEnd}).

import { pool } from "../db/connection.js";
import { env } from "../config/env.js";
import { sendToUser, type PushPayload } from "./push.service.js";
import { ValidationError } from "./errors.js";
import { renderNoteBodyPlain } from "./note-text.js";

export const NOTIFICATION_KEYS = ["lesson_reminder", "stale_lesson", "new_order", "note_reminder", "note_added", "note_reply", "note_mention"] as const;
export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];

// ─── Varsayılanlar (seed ile aynı; config eksik/bozuksa fallback) ────────────
const DEFAULT_LESSON_REMINDER = {
  early: { enabled: true, minutes: 30, suppressIfBusy: true },
  late: { enabled: true, minutes: 10, suppressIfBusy: false },
  titleTemplate: "Ders başlıyor",
  bodyTemplate: "{student} ile dersiniz {minutes} dakika sonra başlıyor.",
};
const DEFAULT_STALE = {
  thresholdMinutes: 120,
  titleTemplate: "Ders durumu bekliyor",
  bodyTemplate: "{student} ile {time} dersi hâlâ 'planlandı' — gerçekleşti mi? Durumu işaretle.",
};
const DEFAULT_NEW_ORDER = {
  titleTemplate: "Yeni sipariş",
  bodyTemplate: "Trendyol'dan yeni sipariş: {customer} — #{order}",
};
// note_reminder'ın DİĞER türlerden farkı: alıcılar burada GLOBAL değil — her
// hatırlatmayla birlikte notu oluşturan kullanıcı tarafından seçilir (bkz.
// note_reminders.recipient_user_ids, notes.service.ts). Bu yüzden yalnız metin
// şablonu ayarlanabilir; recipientUserIds/enabled genel kapatma anlamına gelir.
const DEFAULT_NOTE_REMINDER = {
  titleTemplate: "Not hatırlatması",
  bodyTemplate: "{author}: {note}",
};
// note_added: yeni not/yanıt eklenince. allUsers=true → tüm aktif kullanıcılar
// (yazan hariç); false → recipient_user_ids listesi.
const DEFAULT_NOTE_ADDED = {
  allUsers: true,
  titleTemplate: "{author} yeni not ekledi",
  bodyTemplate: "{note}",
};
const NOTE_ADDED_EXCERPT_MAX_LEN = 100;
// note_reply / note_mention: alıcı GLOBAL değil — ilgili kişidir (notun yazarı /
// etiketlenen). Yalnız metin şablonu ve aç/kapa ayarlanır.
const DEFAULT_NOTE_REPLY = {
  titleTemplate: "{author} size yanıt verdi",
  bodyTemplate: "{note}",
};
const DEFAULT_NOTE_MENTION = {
  titleTemplate: "{author} sizi bir notta etiketledi",
  bodyTemplate: "{note}",
};
const DEFAULT_QUIET = { quietHoursStart: "22:00", quietHoursEnd: "08:00" };

// ─── Küçük tip-güvenli okuyucular ────────────────────────────────────────────
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function numOr(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function boolOr(v: unknown, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}
function strOr(v: unknown, d: string): string {
  return typeof v === "string" && v.trim().length > 0 ? v : d;
}

// ─── Raw satırlar (router → frontend) ────────────────────────────────────────
export type NotificationSettingRow = {
  key: string;
  enabled: boolean;
  recipientUserIds: string[];
  config: Record<string, unknown>;
  updatedAt: string;
};

export async function listNotificationSettings(): Promise<NotificationSettingRow[]> {
  const { rows } = await pool.query<{
    key: string;
    enabled: boolean;
    recipient_user_ids: string[] | null;
    config: Record<string, unknown>;
    updated_at: string;
  }>(
    `SELECT key, enabled, recipient_user_ids, config, updated_at::text AS updated_at
       FROM notification_settings
      ORDER BY CASE key
        WHEN 'lesson_reminder' THEN 1
        WHEN 'stale_lesson' THEN 2
        WHEN 'new_order' THEN 3
        WHEN 'note_reminder' THEN 4
        WHEN 'note_added' THEN 5
        WHEN 'note_reply' THEN 6
        WHEN 'note_mention' THEN 7
        WHEN '_global' THEN 8
        ELSE 9 END`,
  );
  return rows.map((r) => ({
    key: r.key,
    enabled: r.enabled,
    recipientUserIds: (r.recipient_user_ids ?? []).map(String),
    config: r.config ?? {},
    updatedAt: r.updated_at,
  }));
}

// ─── Scheduler'ın kullandığı normalize edilmiş config ────────────────────────
export type SlotConfig = { enabled: boolean; minutes: number; suppressIfBusy: boolean };
export type LoadedNotificationConfig = {
  lessonReminder: {
    enabled: boolean;
    recipients: string[];
    early: SlotConfig;
    late: SlotConfig;
    titleTemplate: string;
    bodyTemplate: string;
  };
  staleLesson: {
    enabled: boolean;
    recipients: string[];
    thresholdMinutes: number;
    titleTemplate: string;
    bodyTemplate: string;
  };
  newOrder: {
    enabled: boolean;
    recipients: string[];
    titleTemplate: string;
    bodyTemplate: string;
  };
  // recipients YOK — bkz. DEFAULT_NOTE_REMINDER üstteki not.
  noteReminder: {
    enabled: boolean;
    titleTemplate: string;
    bodyTemplate: string;
  };
  noteAdded: {
    enabled: boolean;
    allUsers: boolean;
    recipients: string[];
    titleTemplate: string;
    bodyTemplate: string;
  };
  noteReply: { enabled: boolean; titleTemplate: string; bodyTemplate: string };
  noteMention: { enabled: boolean; titleTemplate: string; bodyTemplate: string };
  quietHours: { enabled: boolean; start: string; end: string };
};

function slot(v: unknown, def: SlotConfig): SlotConfig {
  const o = asObj(v);
  return {
    enabled: boolOr(o.enabled, def.enabled),
    minutes: Math.max(1, Math.min(720, Math.round(numOr(o.minutes, def.minutes)))),
    suppressIfBusy: boolOr(o.suppressIfBusy, def.suppressIfBusy),
  };
}

export async function loadNotificationConfig(): Promise<LoadedNotificationConfig> {
  const rows = await listNotificationSettings();
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const lr = byKey.get("lesson_reminder");
  const lrCfg = asObj(lr?.config);
  const st = byKey.get("stale_lesson");
  const stCfg = asObj(st?.config);
  const no = byKey.get("new_order");
  const noCfg = asObj(no?.config);
  const nr = byKey.get("note_reminder");
  const nrCfg = asObj(nr?.config);
  const na = byKey.get("note_added");
  const naCfg = asObj(na?.config);
  const nrp = byKey.get("note_reply");
  const nrpCfg = asObj(nrp?.config);
  const nmn = byKey.get("note_mention");
  const nmnCfg = asObj(nmn?.config);
  const gl = byKey.get("_global");
  const glCfg = asObj(gl?.config);

  return {
    lessonReminder: {
      enabled: lr?.enabled ?? true,
      recipients: lr?.recipientUserIds ?? [],
      early: slot(lrCfg.early, DEFAULT_LESSON_REMINDER.early),
      late: slot(lrCfg.late, DEFAULT_LESSON_REMINDER.late),
      titleTemplate: strOr(lrCfg.titleTemplate, DEFAULT_LESSON_REMINDER.titleTemplate),
      bodyTemplate: strOr(lrCfg.bodyTemplate, DEFAULT_LESSON_REMINDER.bodyTemplate),
    },
    staleLesson: {
      enabled: st?.enabled ?? true,
      recipients: st?.recipientUserIds ?? [],
      thresholdMinutes: Math.max(1, Math.min(10080, Math.round(numOr(stCfg.thresholdMinutes, DEFAULT_STALE.thresholdMinutes)))),
      titleTemplate: strOr(stCfg.titleTemplate, DEFAULT_STALE.titleTemplate),
      bodyTemplate: strOr(stCfg.bodyTemplate, DEFAULT_STALE.bodyTemplate),
    },
    newOrder: {
      enabled: no?.enabled ?? true,
      recipients: no?.recipientUserIds ?? [],
      titleTemplate: strOr(noCfg.titleTemplate, DEFAULT_NEW_ORDER.titleTemplate),
      bodyTemplate: strOr(noCfg.bodyTemplate, DEFAULT_NEW_ORDER.bodyTemplate),
    },
    noteReminder: {
      enabled: nr?.enabled ?? true,
      titleTemplate: strOr(nrCfg.titleTemplate, DEFAULT_NOTE_REMINDER.titleTemplate),
      bodyTemplate: strOr(nrCfg.bodyTemplate, DEFAULT_NOTE_REMINDER.bodyTemplate),
    },
    noteAdded: {
      enabled: na?.enabled ?? true,
      allUsers: boolOr(naCfg.allUsers, DEFAULT_NOTE_ADDED.allUsers),
      recipients: na?.recipientUserIds ?? [],
      titleTemplate: strOr(naCfg.titleTemplate, DEFAULT_NOTE_ADDED.titleTemplate),
      bodyTemplate: strOr(naCfg.bodyTemplate, DEFAULT_NOTE_ADDED.bodyTemplate),
    },
    noteReply: {
      enabled: nrp?.enabled ?? true,
      titleTemplate: strOr(nrpCfg.titleTemplate, DEFAULT_NOTE_REPLY.titleTemplate),
      bodyTemplate: strOr(nrpCfg.bodyTemplate, DEFAULT_NOTE_REPLY.bodyTemplate),
    },
    noteMention: {
      enabled: nmn?.enabled ?? true,
      titleTemplate: strOr(nmnCfg.titleTemplate, DEFAULT_NOTE_MENTION.titleTemplate),
      bodyTemplate: strOr(nmnCfg.bodyTemplate, DEFAULT_NOTE_MENTION.bodyTemplate),
    },
    quietHours: {
      enabled: gl?.enabled ?? false,
      start: strOr(glCfg.quietHoursStart, DEFAULT_QUIET.quietHoursStart),
      end: strOr(glCfg.quietHoursEnd, DEFAULT_QUIET.quietHoursEnd),
    },
  };
}

// ─── Şablon değişkenleri: {ad} → değer ───────────────────────────────────────
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

// ─── Alıcı ID listesinden yalnız AKTİF kullanıcıları döndür ──────────────────
export async function resolveActiveRecipients(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE id = ANY($1::bigint[]) AND is_active = true`,
    [userIds],
  );
  return rows.map((r) => r.id);
}

// ─── Sessiz saat penceresi ───────────────────────────────────────────────────
function hhmmToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function zoneMinutesNow(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

// now (verilen TZ'de) [start, end) sessiz penceresinde mi? Gece yarısını saran
// pencere (ör. 22:00–08:00) desteklenir. Geçersiz/eşit sınır → pencere yok.
export function isWithinQuietHours(now: Date, start: string, end: string, timeZone: string): boolean {
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  if (s === null || e === null || s === e) return false;
  const cur = zoneMinutesNow(now, timeZone);
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

// ─── Güncelleme (PATCH) ──────────────────────────────────────────────────────
type UpdatePatch = {
  enabled?: boolean;
  recipientUserIds?: Array<number | string>;
  config?: Record<string, unknown>;
};

function validateTemplateStr(v: unknown, label: string): string {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new ValidationError(`${label} boş olamaz.`);
  }
  if (v.length > 300) throw new ValidationError(`${label} en fazla 300 karakter olabilir.`);
  return v;
}

function validateSlot(v: unknown, label: string): SlotConfig {
  const o = asObj(v);
  const minutes = Math.round(numOr(o.minutes, NaN));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 720) {
    throw new ValidationError(`${label} dakikası 1–720 arasında olmalı.`);
  }
  return {
    enabled: boolOr(o.enabled, true),
    minutes,
    suppressIfBusy: boolOr(o.suppressIfBusy, false),
  };
}

// key'e göre config'i doğrula + normalize et (bilinmeyen alanlar atılır).
function validateConfigForKey(key: string, raw: Record<string, unknown>): Record<string, unknown> {
  if (key === "lesson_reminder") {
    return {
      early: validateSlot(raw.early, "Erken hatırlatma"),
      late: validateSlot(raw.late, "Geç hatırlatma"),
      titleTemplate: validateTemplateStr(raw.titleTemplate, "Başlık"),
      bodyTemplate: validateTemplateStr(raw.bodyTemplate, "Metin"),
    };
  }
  if (key === "stale_lesson") {
    const threshold = Math.round(numOr(raw.thresholdMinutes, NaN));
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 10080) {
      throw new ValidationError("Eşik süresi 1–10080 dakika arasında olmalı.");
    }
    return {
      thresholdMinutes: threshold,
      titleTemplate: validateTemplateStr(raw.titleTemplate, "Başlık"),
      bodyTemplate: validateTemplateStr(raw.bodyTemplate, "Metin"),
    };
  }
  if (key === "new_order" || key === "note_reminder" || key === "note_reply" || key === "note_mention") {
    return {
      titleTemplate: validateTemplateStr(raw.titleTemplate, "Başlık"),
      bodyTemplate: validateTemplateStr(raw.bodyTemplate, "Metin"),
    };
  }
  if (key === "note_added") {
    return {
      allUsers: boolOr(raw.allUsers, true),
      titleTemplate: validateTemplateStr(raw.titleTemplate, "Başlık"),
      bodyTemplate: validateTemplateStr(raw.bodyTemplate, "Metin"),
    };
  }
  if (key === "_global") {
    const start = strOr(raw.quietHoursStart, DEFAULT_QUIET.quietHoursStart);
    const end = strOr(raw.quietHoursEnd, DEFAULT_QUIET.quietHoursEnd);
    if (hhmmToMinutes(start) === null || hhmmToMinutes(end) === null) {
      throw new ValidationError("Sessiz saat SS:DD biçiminde olmalı (ör. 22:00).");
    }
    return { quietHoursStart: start, quietHoursEnd: end };
  }
  throw new ValidationError("Bilinmeyen bildirim anahtarı.");
}

// recipientUserIds: yalnız gerçekten VAR olan kullanıcı id'leri saklanır
// (tekrarsız). Kişi-bazlı model; rol değil id tutulur.
async function sanitizeRecipients(ids: Array<number | string>): Promise<string[]> {
  const cleaned = Array.from(
    new Set(
      ids
        .map((x) => Number(x))
        .filter((n) => Number.isInteger(n) && n > 0)
        .map(String),
    ),
  );
  if (cleaned.length === 0) return [];
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE id = ANY($1::bigint[])`,
    [cleaned],
  );
  return rows.map((r) => r.id);
}

export async function updateNotificationSetting(key: string, patch: UpdatePatch): Promise<NotificationSettingRow> {
  const existing = await pool.query<{ key: string }>(
    `SELECT key FROM notification_settings WHERE key = $1`,
    [key],
  );
  if (!existing.rows[0]) throw new ValidationError("Bilinmeyen bildirim anahtarı.");

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== "boolean") throw new ValidationError("enabled boolean olmalı.");
    sets.push(`enabled = $${i++}`);
    values.push(patch.enabled);
  }

  // '_global' ve 'note_reminder' satırlarının GLOBAL alıcısı yoktur (bkz.
  // DEFAULT_NOTE_REMINDER üstteki not); verilse bile yok sayılır.
  const noGlobalRecipients = key === "_global" || key === "note_reminder" || key === "note_reply" || key === "note_mention";
  if (patch.recipientUserIds !== undefined && !noGlobalRecipients) {
    if (!Array.isArray(patch.recipientUserIds)) throw new ValidationError("recipientUserIds dizi olmalı.");
    const clean = await sanitizeRecipients(patch.recipientUserIds);
    sets.push(`recipient_user_ids = $${i++}::bigint[]`);
    values.push(clean);
  }

  if (patch.config !== undefined) {
    const normalized = validateConfigForKey(key, asObj(patch.config));
    sets.push(`config = $${i++}::jsonb`);
    values.push(JSON.stringify(normalized));
  }

  if (sets.length === 0) {
    const rows = await listNotificationSettings();
    const row = rows.find((r) => r.key === key);
    if (!row) throw new ValidationError("Bilinmeyen bildirim anahtarı.");
    return row;
  }

  sets.push(`updated_at = now()`);
  values.push(key);
  await pool.query(`UPDATE notification_settings SET ${sets.join(", ")} WHERE key = $${i}`, values);

  const rows = await listNotificationSettings();
  const row = rows.find((r) => r.key === key);
  if (!row) throw new ValidationError("Bilinmeyen bildirim anahtarı.");
  return row;
}

// ─── Test gönderimi: türün GÜNCEL şablonunu örnek değişkenlerle çağırana yollar ─
const SAMPLE_VARS: Record<NotificationKey, Record<string, string | number>> = {
  lesson_reminder: { student: "Örnek Öğrenci", minutes: 30 },
  stale_lesson: { student: "Örnek Öğrenci", time: "14:00" },
  new_order: { customer: "Örnek Müşteri", order: "1234567890" },
  note_reminder: { author: "Örnek Kullanıcı", note: "Salı günü matlar temizlenecek." },
  note_added: { author: "Örnek Kullanıcı", note: "Salı günü matlar temizlenecek." },
  note_reply: { author: "Örnek Kullanıcı", note: "Tamam, ben hallederim." },
  note_mention: { author: "Örnek Kullanıcı", note: "@Sen matları kontrol eder misin?" },
};

// Çağırana (owner) örnek değişkenlerle test push'u yollar; kaç cihaza gittiğini
// döner (0 → abonelik yok). VAPID yoksa sendToUser 503 fırlatır.
export async function sendTestNotification(key: string, toUserId: string): Promise<number> {
  if (!(NOTIFICATION_KEYS as readonly string[]).includes(key)) {
    throw new ValidationError("Bu bildirim türü için test gönderilemez.");
  }
  const rows = await listNotificationSettings();
  const row = rows.find((r) => r.key === key);
  if (!row) throw new ValidationError("Bilinmeyen bildirim anahtarı.");

  const cfg = asObj(row.config);
  const defaults =
    key === "lesson_reminder" ? DEFAULT_LESSON_REMINDER
    : key === "stale_lesson" ? DEFAULT_STALE
    : key === "note_reminder" ? DEFAULT_NOTE_REMINDER
    : key === "note_added" ? DEFAULT_NOTE_ADDED
    : key === "note_reply" ? DEFAULT_NOTE_REPLY
    : key === "note_mention" ? DEFAULT_NOTE_MENTION
    : DEFAULT_NEW_ORDER;
  const vars = SAMPLE_VARS[key as NotificationKey];
  const payload: PushPayload = {
    title: `[Test] ${renderTemplate(strOr(cfg.titleTemplate, defaults.titleTemplate), vars)}`,
    body: renderTemplate(strOr(cfg.bodyTemplate, defaults.bodyTemplate), vars),
    url: "/",
  };
  return sendToUser(toUserId, payload);
}

// ─── Yeni not bildirimi (anlık; scheduler'dan bağımsız) ──────────────────────
// Her kişiye EN FAZLA BİR bildirim gider, öncelik sırasıyla:
//   1. notun yazarına yanıt   → note_reply   ("size yanıt verdi")
//   2. etiketlenen kişiler    → note_mention ("sizi etiketledi")
//   3. kalan alıcılar         → note_added   ("yeni not ekledi")
// Yazan kişi hiçbirini almaz. Sessiz saatlerde gönderim ATLANIR (ertelenmez — not
// anlık bir olay). Push yapılandırılmamışsa veya hata olursa sessizce loglanır;
// not akışını bozmaz.
export async function notifyNoteAdded(input: {
  authorUserId: string | number;
  body: string;
  parentAuthorUserId?: string | null;
  mentionedUserIds?: string[];
}): Promise<void> {
  try {
    if (!env.vapidPublicKey || !env.vapidPrivateKey) return;
    const cfg = await loadNotificationConfig();
    if (cfg.quietHours.enabled && isWithinQuietHours(new Date(), cfg.quietHours.start, cfg.quietHours.end, env.timeZone)) {
      return;
    }

    const authorId = String(input.authorUserId);
    const author = await pool.query<{ display_name: string }>(
      `SELECT display_name FROM users WHERE id = $1`,
      [authorId],
    );
    const plain = (await renderNoteBodyPlain(input.body)).trim();
    const excerpt = plain.length > NOTE_ADDED_EXCERPT_MAX_LEN
      ? `${plain.slice(0, NOTE_ADDED_EXCERPT_MAX_LEN).trimEnd()}…`
      : plain;
    const vars = { author: author.rows[0]?.display_name ?? "Bir kullanıcı", note: excerpt };

    const notified = new Set<string>([authorId]);
    async function deliver(userIds: string[], titleTemplate: string, bodyTemplate: string): Promise<void> {
      const targets = (await resolveActiveRecipients(userIds.filter((id) => !notified.has(id))))
        .map(String)
        .filter((id) => !notified.has(id));
      const payload: PushPayload = {
        title: renderTemplate(titleTemplate, vars),
        body: renderTemplate(bodyTemplate, vars),
        url: "/",
      };
      for (const userId of targets) {
        notified.add(userId);
        try {
          await sendToUser(userId, payload);
        } catch (err) {
          console.error(`[notif] not push hatası (user=${userId}):`, err instanceof Error ? err.message : err);
        }
      }
    }

    if (input.parentAuthorUserId && cfg.noteReply.enabled) {
      await deliver([String(input.parentAuthorUserId)], cfg.noteReply.titleTemplate, cfg.noteReply.bodyTemplate);
    }
    if (input.mentionedUserIds && input.mentionedUserIds.length > 0 && cfg.noteMention.enabled) {
      await deliver(input.mentionedUserIds.map(String), cfg.noteMention.titleTemplate, cfg.noteMention.bodyTemplate);
    }
    if (cfg.noteAdded.enabled) {
      let recipients: string[];
      if (cfg.noteAdded.allUsers) {
        const { rows } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE is_active = true`);
        recipients = rows.map((r) => String(r.id));
      } else {
        recipients = cfg.noteAdded.recipients;
      }
      await deliver(recipients, cfg.noteAdded.titleTemplate, cfg.noteAdded.bodyTemplate);
    }
  } catch (err) {
    console.error("[notif] yeni not bildirimi hatası:", err instanceof Error ? err.message : err);
  }
}
