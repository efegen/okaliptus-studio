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

export const NOTIFICATION_KEYS = ["lesson_reminder", "stale_lesson", "new_order"] as const;
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
        WHEN '_global' THEN 4
        ELSE 5 END`,
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
  if (key === "new_order") {
    return {
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

  // '_global' satırının alıcısı yoktur; verilse bile yok sayılır.
  if (patch.recipientUserIds !== undefined && key !== "_global") {
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
    : DEFAULT_NEW_ORDER;
  const vars = SAMPLE_VARS[key as NotificationKey];
  const payload: PushPayload = {
    title: `[Test] ${renderTemplate(strOr(cfg.titleTemplate, defaults.titleTemplate), vars)}`,
    body: renderTemplate(strOr(cfg.bodyTemplate, defaults.bodyTemplate), vars),
    url: "/",
  };
  return sendToUser(toUserId, payload);
}
