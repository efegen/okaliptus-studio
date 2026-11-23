// Web sitesi formları → panel "Talepler" (bkz. migration 0296).
//
// Site (okaliptusyoga.com) üç formu tek uca gönderir: POST /public/inquiries
// (oturumsuz, bkz. routes/site-inquiries.router.ts). Bu dosya gönderimi
// doğrular, sınıflandırır ve kaydeder; panelin listeleme/güncelleme işlerini de
// yapar. Bildirim gönderimi notification-scheduler.ts'te.
//
// İLKE: gerçek bir ziyaretçinin formu kaybolmaz.
//   - Şüpheli görünen gönderim (tuzak alan dolu, çok hızlı, Origin yok, aynı
//     kaynaktan çok sık, doğrulama başarısız) REDDEDİLMEZ: kaydedilir, bildirim
//     göndermez, panelde "şüpheli" olarak bekler. Ziyaretçi her durumda aynı
//     yanıtı alır (bot neye takıldığını öğrenmez).
//   - Yalnız eksik ad / geçersiz telefon / bilinmeyen form reddedilir (422,
//     alan bazında mesajla; site bunu formda gösterir).
//   - Uzun metinler kırpılır, bilinmeyen alanlar atılır; e-posta biçimi sunucuda
//     reddedilmez (site zaten kontrol ediyor, sunucu katı olursa form kaybolur).
//   - Tekrar deneme aynı client_id ile gelir → yeni satır açılmaz.
//
// SINIRLAR (fatura ve gelen kutusu için):
//   - Günlük TEMİZ talep tavanı (SITE_FORM_DAILY_LIMIT, varsayılan 200): aşılırsa
//     503 → site telefon numarasını gösterir; panele bir kez uyarı bildirimi gider.
//   - Günlük ŞÜPHELİ tavanı (SITE_FORM_SUSPECT_DAILY_LIMIT, 100): aşılırsa yeni
//     şüpheliler sessizce kaydedilmez. Şüpheliler temiz tavanı DOLDURMAZ; yani
//     tuzağa düşen bot seli gerçek ziyaretçiyi engelleyemez.
//   - IP başına istek sınırları router'da (express-rate-limit, bellek içi).

import { randomUUID } from "node:crypto";

import { pool } from "../db/connection.js";
import { env } from "../config/env.js";
import { AppError, ValidationError } from "./errors.js";

export const INQUIRY_KINDS = ["contact", "lesson", "camp"] as const;
export type InquiryKind = (typeof INQUIRY_KINDS)[number];

export const INQUIRY_STATUSES = ["new", "contacted", "converted", "closed", "spam"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export type SuspectReason = "trap" | "too_fast" | "no_origin" | "burst" | "captcha";

// ─── Ayarlar (her çağrıda env'den okunur; testler değiştirebilir) ────────────
const SITE_ORIGINS = ["https://okaliptusyoga.com", "https://www.okaliptusyoga.com"];
// Astro dev sunucusu; yalnız production dışında.
const DEV_ORIGINS = ["http://localhost:4321", "http://127.0.0.1:4321"];

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export type SiteFormSettings = {
  enabled: boolean;
  origins: Set<string>;
  dailyLimit: number;
  suspectDailyLimit: number;
  minFillMs: number;
  turnstileSecret: string;
};

export function siteFormSettings(): SiteFormSettings {
  const extra = (process.env.SITE_FORM_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  // Sitenin kendi adresleri her zaman izinli: env unutulsa da formlar çalışır.
  const origins = new Set([...SITE_ORIGINS, ...extra, ...(env.nodeEnv === "production" ? [] : DEV_ORIGINS)]);
  return {
    enabled: (process.env.SITE_FORMS_ENABLED ?? "true").trim().toLowerCase() !== "false",
    origins,
    dailyLimit: intEnv("SITE_FORM_DAILY_LIMIT", 200, 1, 100_000),
    suspectDailyLimit: intEnv("SITE_FORM_SUSPECT_DAILY_LIMIT", 100, 0, 100_000),
    minFillMs: intEnv("SITE_FORM_MIN_FILL_MS", 1500, 0, 60_000),
    turnstileSecret: (process.env.TURNSTILE_SECRET_KEY ?? "").trim(),
  };
}

// ─── Hatalar ─────────────────────────────────────────────────────────────────
/** 422 + alan bazında Türkçe mesaj; site bunları ilgili alanın altında gösterir. */
export class InquiryValidationError extends AppError {
  readonly fields: Record<string, string>;
  constructor(fields: Record<string, string>) {
    super("VALIDATION_ERROR", "Formu kontrol edin.", 422);
    this.fields = fields;
  }
}

/** Günlük tavan doldu: site telefon numarasını gösterir, form verisi tarayıcıda kalır. */
export class SiteFormsBusyError extends AppError {
  constructor() {
    super("BUSY", "Şu an formu alamıyoruz. Lütfen telefonla ulaşın.", 503);
  }
}

// ─── Metin temizleme ─────────────────────────────────────────────────────────
// Kontrol karakterleri ve yön değiştiren Unicode işaretleri (bildirimde metni
// ters gösterip kandırmak için kullanılabilir) atılır. Kırpma kod noktası
// bazında yapılır (emoji/vekil çift yarıda kesilmez).
const BIDI = /[‎‏‪-‮⁦-⁩]/g;

export function cleanText(value: unknown, max: number, multiline = false): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let s = String(value).normalize("NFC").replace(BIDI, "");
  if (multiline) {
    s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "");
    s = s.replace(/\n{3,}/g, "\n\n").trim();
  } else {
    s = s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  }
  if (!s) return null;
  const points = [...s];
  return points.length > max ? points.slice(0, max).join("").trimEnd() : s;
}

/** Yalnız rakamlar, son 10 hane. 7–15 rakam dışı → geçersiz (null). */
export function phoneKeyOf(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return digits.slice(-10);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Forma özel alanlar: yalnız bunlar saklanır (sayı → en fazla karakter;
// "people" tam sayı, 1–20). Etiketler sitenin o anki metnidir.
const DETAIL_FIELDS: Record<InquiryKind, Record<string, number | "people">> = {
  contact: { topic: 40, topicLabel: 80 },
  lesson: { mode: 20, modeLabel: 60, city: 60 },
  camp: {
    event: 120,
    eventTitle: 160,
    eventDate: 80,
    entry: 40,
    entryLabel: 80,
    people: "people",
    room: 40,
    roomLabel: 80,
    price: 60,
  },
};

export type InquiryInput = {
  clientId: string;
  kind: InquiryKind;
  fullName: string;
  phone: string;
  phoneKey: string;
  email: string | null;
  message: string | null;
  details: Record<string, string | number>;
  page: string | null;
};

export type ParsedSubmission = {
  input: InquiryInput;
  trap: boolean;
  elapsedMs: number | null;
  turnstileToken: string | null;
};

export function parseSubmission(body: unknown): ParsedSubmission {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InquiryValidationError({ form: "Geçersiz istek." });
  }
  const b = body as Record<string, unknown>;
  const fields: Record<string, string> = {};

  const kind = (INQUIRY_KINDS as readonly string[]).includes(String(b.kind)) ? (b.kind as InquiryKind) : null;
  if (!kind) fields.kind = "Bilinmeyen form.";

  const fullName = cleanText(b.name, 120);
  if (!fullName || [...fullName].length < 2) fields.name = "Adınızı ve soyadınızı yazın.";

  const phone = cleanText(b.phone, 40);
  const phoneKey = phone ? phoneKeyOf(phone) : null;
  if (!phone) fields.phone = "Telefon numaranızı yazın.";
  else if (!phoneKey) fields.phone = "Telefon numaranızı kontrol edin.";

  if (Object.keys(fields).length > 0 || !kind || !fullName || !phone || !phoneKey) {
    throw new InquiryValidationError(fields);
  }

  const details: Record<string, string | number> = {};
  const rawDetails = b.details && typeof b.details === "object" && !Array.isArray(b.details)
    ? (b.details as Record<string, unknown>)
    : {};
  for (const [key, rule] of Object.entries(DETAIL_FIELDS[kind])) {
    if (rule === "people") {
      const n = Number(rawDetails[key]);
      if (Number.isInteger(n) && n >= 1) details[key] = Math.min(20, n);
      continue;
    }
    const v = cleanText(rawDetails[key], rule);
    if (v) details[key] = v;
  }

  const clientId = typeof b.clientId === "string" && UUID_RE.test(b.clientId) ? b.clientId.toLowerCase() : randomUUID();
  const elapsed = Number(b.elapsedMs);

  return {
    input: {
      clientId,
      kind,
      fullName,
      phone,
      phoneKey,
      email: cleanText(b.email, 254),
      message: cleanText(b.message, 4000, true),
      details,
      page: cleanText(b.page, 300),
    },
    trap: cleanText(b.trap, 200) !== null,
    elapsedMs: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
    turnstileToken: cleanText(b.turnstileToken, 2048),
  };
}

/** Ucuz, veritabanısız şüphe kontrolü. İlk eşleşen neden döner. */
export function classifySubmission(
  parsed: ParsedSubmission,
  ctx: { hasOrigin: boolean; burst: boolean },
  minFillMs: number,
): SuspectReason | null {
  if (parsed.trap) return "trap";
  if (parsed.elapsedMs === null || parsed.elapsedMs < minFillMs) return "too_fast";
  if (!ctx.hasOrigin) return "no_origin";
  if (ctx.burst) return "burst";
  return null;
}

// ─── Cloudflare Turnstile (isteğe bağlı) ─────────────────────────────────────
// TURNSTILE_SECRET_KEY tanımlıysa temiz görünen gönderimin bileti doğrulanır.
// Bilet yok/geçersiz → şüpheli (reddedilmez). Cloudflare'e ulaşılamazsa
// gönderim temiz sayılır: dış servisin arızası ziyaretçiyi cezalandırmaz.
export async function verifyTurnstile(
  secret: string,
  token: string | null,
  ip: string | undefined,
  allowedHosts: Set<string>,
): Promise<"pass" | "fail" | "error"> {
  if (!token) return "fail";
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return "error";
    const json = (await r.json()) as { success?: boolean; hostname?: string };
    if (json.success !== true) return "fail";
    if (json.hostname && allowedHosts.size > 0 && !allowedHosts.has(json.hostname)) return "fail";
    return "pass";
  } catch {
    return "error";
  }
}

// ─── Kayıt ───────────────────────────────────────────────────────────────────
export type ReceiveResult =
  | { outcome: "stored"; id: string; notify: boolean }
  | { outcome: "repeat"; id: string }
  | { outcome: "dropped" };

type DayCounts = { clean: number; suspect: number };

async function countToday(): Promise<DayCounts> {
  const { rows } = await pool.query<{ clean: string; suspect: string }>(
    `SELECT count(*) FILTER (WHERE suspect_reason IS NULL)     AS clean,
            count(*) FILTER (WHERE suspect_reason IS NOT NULL) AS suspect
       FROM site_inquiries
      WHERE created_at >= (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1)`,
    [env.timeZone],
  );
  return { clean: Number(rows[0]?.clean ?? 0), suspect: Number(rows[0]?.suspect ?? 0) };
}

/**
 * Doğrulanmış gönderimi kaydeder. Sıra: tekrar (client_id) → günlük tavanlar →
 * Turnstile (varsa) → aynı kişiden tekrar → INSERT.
 * Temiz tavan doluysa SiteFormsBusyError fırlatır (çağıran uyarı bildirimini yollar).
 */
export async function receiveInquiry(args: {
  parsed: ParsedSubmission;
  suspect: SuspectReason | null;
  ip: string | undefined;
  settings: SiteFormSettings;
}): Promise<ReceiveResult> {
  const { parsed, settings, ip } = args;
  const input = parsed.input;
  let suspect = args.suspect;

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM site_inquiries WHERE client_id = $1`,
    [input.clientId],
  );
  if (existing.rows[0]) return { outcome: "repeat", id: existing.rows[0].id };

  const counts = await countToday();
  if (!suspect && counts.clean >= settings.dailyLimit) throw new SiteFormsBusyError();

  if (!suspect && settings.turnstileSecret) {
    const hosts = new Set([...settings.origins].map((o) => {
      try { return new URL(o).hostname; } catch { return ""; }
    }).filter(Boolean));
    const verdict = await verifyTurnstile(settings.turnstileSecret, parsed.turnstileToken, ip, hosts);
    if (verdict === "fail") suspect = "captcha";
    else if (verdict === "error") console.warn("[site-forms] Turnstile doğrulanamadı; gönderim temiz sayıldı.");
  }

  if (suspect && counts.suspect >= settings.suspectDailyLimit) return { outcome: "dropped" };

  // Aynı kişi (telefon) aynı formu 24 saat içinde yeniden gönderdiyse ve ilki
  // hâlâ yeniyse: ayrı satır, ilkine bağlı, ikinci bildirim yok. Kampta
  // yalnız aynı etkinlik için.
  let duplicateOf: string | null = null;
  if (!suspect) {
    const dup = await pool.query<{ id: string }>(
      `SELECT id FROM site_inquiries
        WHERE phone_key = $1 AND kind = $2
          AND suspect_reason IS NULL AND duplicate_of IS NULL AND status = 'new'
          AND created_at > now() - interval '24 hours'
          AND ($2 <> 'camp' OR details->>'event' IS NOT DISTINCT FROM $3)
        ORDER BY created_at DESC
        LIMIT 1`,
      [input.phoneKey, input.kind, (input.details.event as string | undefined) ?? null],
    );
    duplicateOf = dup.rows[0]?.id ?? null;
  }

  const notify = !suspect && !duplicateOf;
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO site_inquiries
       (client_id, kind, suspect_reason, full_name, phone, phone_key, email, message,
        details, page, duplicate_of, notified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11,
             CASE WHEN $12::boolean THEN NULL ELSE now() END)
     ON CONFLICT (client_id) DO NOTHING
     RETURNING id`,
    [
      input.clientId, input.kind, suspect, input.fullName, input.phone, input.phoneKey,
      input.email, input.message, JSON.stringify(input.details), input.page, duplicateOf, notify,
    ],
  );
  if (!inserted.rows[0]) {
    // Aynı client_id eşzamanlı geldi; ilk istek kaydetti.
    const again = await pool.query<{ id: string }>(`SELECT id FROM site_inquiries WHERE client_id = $1`, [input.clientId]);
    return { outcome: "repeat", id: again.rows[0]?.id ?? "" };
  }
  return { outcome: "stored", id: inserted.rows[0].id, notify };
}

// ─── Bildirim metni ──────────────────────────────────────────────────────────
export const INQUIRY_TITLES: Record<InquiryKind, string> = {
  contact: "Yeni mesaj",
  lesson: "Yeni ders talebi",
  camp: "Yeni ön kayıt",
};

export function inquiryExcerpt(text: string | null, max: number): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  const points = [...flat];
  return points.length > max ? `${points.slice(0, max).join("").trimEnd()}…` : flat;
}

/** Tek satır özet: "Pamukkale Yoga Kampı, 2 kişi, 2 ya da 3 kişilik oda". */
export function inquirySummary(kind: string, details: Record<string, unknown>, message: string | null): string {
  const s = (k: string) => (typeof details[k] === "string" ? (details[k] as string) : null);
  let parts: Array<string | null> = [];
  if (kind === "camp") {
    const people = Number(details.people);
    parts = [s("eventTitle") ?? s("event"), Number.isInteger(people) && people > 0 ? `${people} kişi` : null, s("roomLabel")];
  } else if (kind === "lesson") {
    parts = [s("modeLabel") ?? s("mode"), s("city")];
  } else {
    parts = [s("topicLabel") ?? s("topic")];
  }
  const joined = parts.filter(Boolean).join(", ");
  return joined || inquiryExcerpt(message, 80);
}

// ─── Panel: liste / detay / güncelleme ───────────────────────────────────────
// Aynı kişinin 24 saat içindeki tekrar gönderimleri (duplicate_of dolu) listede
// ayrı satır olmaz: ilk gönderim "baş" satırdır, tekrarlar onun altında sayılır.
// Baş satır EN SON gönderimin bilgilerini gösterir (kişi formu düzeltip yeniden
// göndermiş olabilir); kimlik, durum ve geliş zamanı baş satırınkidir.
// Sayaçlar ve kutular yalnız baş satırları sayar.
export const INQUIRY_BOXES = ["new", "contacted", "done", "suspect", "spam", "all"] as const;
export type InquiryBox = (typeof INQUIRY_BOXES)[number];

const BOX_WHERE: Record<InquiryBox, string> = {
  new: `i.status = 'new' AND i.suspect_reason IS NULL`,
  contacted: `i.status = 'contacted'`,
  done: `i.status IN ('converted', 'closed')`,
  suspect: `i.status = 'new' AND i.suspect_reason IS NOT NULL`,
  spam: `i.status = 'spam'`,
  all: `true`,
};

type InquiryRow = {
  id: string;
  kind: InquiryKind;
  status: InquiryStatus;
  suspect_reason: SuspectReason | null;
  full_name: string;
  phone: string;
  email: string | null;
  message: string | null;
  details: Record<string, unknown>;
  page: string | null;
  duplicate_of: string | null;
  created_at: string;
  notified_at: string | null;
  handled_by: string | null;
  handled_by_name: string | null;
  handled_at: string | null;
  note: string | null;
  updated_at: string;
  student_id: string | null;
  student_name: string | null;
  last_details: Record<string, unknown> | null;
  last_message: string | null;
  last_email: string | null;
  last_at: string | null;
  duplicate_count: string | null;
  origin: Record<string, unknown> | null;
};

export type SiteInquiry = {
  id: string;
  kind: InquiryKind;
  status: InquiryStatus;
  suspectReason: SuspectReason | null;
  fullName: string;
  phone: string;
  email: string | null;
  message: string | null;
  details: Record<string, unknown>;
  summary: string;
  page: string | null;
  duplicateOf: string | null;
  createdAt: string;
  // Tekrarlar dahil gönderim sayısı ve en son gönderimin zamanı.
  submissionCount: number;
  lastSubmittedAt: string;
  notifiedAt: string | null;
  handledBy: { id: string; name: string } | null;
  handledAt: string | null;
  note: string | null;
  updatedAt: string;
  // Telefonu kayıtlı bir öğrenciyle eşleşiyorsa (son 10 hane).
  student: { id: string; fullName: string } | null;
  // Formun geldiği ziyaretin özeti (bkz. site-stats.service.ts → InquiryOrigin);
  // ziyaret bulunamadıysa null.
  origin: Record<string, unknown> | null;
};

const SELECT_INQUIRY = `
  SELECT i.id, i.kind, i.status, i.suspect_reason, i.full_name, i.phone, i.email, i.message,
         i.details, i.page, i.duplicate_of, i.created_at::text, i.notified_at::text,
         i.handled_by, u.display_name AS handled_by_name, i.handled_at::text, i.note,
         i.updated_at::text, st.id AS student_id, st.full_name AS student_name,
         last.details AS last_details, last.message AS last_message, last.email AS last_email,
         last.created_at::text AS last_at, dup.n AS duplicate_count, i.origin
    FROM site_inquiries i
    LEFT JOIN users u ON u.id = i.handled_by
    LEFT JOIN LATERAL (
      SELECT d.details, d.message, d.email, d.created_at
        FROM site_inquiries d
       WHERE d.duplicate_of = i.id
       ORDER BY d.id DESC
       LIMIT 1
    ) last ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::text AS n FROM site_inquiries d WHERE d.duplicate_of = i.id
    ) dup ON true
    LEFT JOIN LATERAL (
      SELECT s.id, s.full_name
        FROM students s
       WHERE s.deleted_at IS NULL
         AND s.phone IS NOT NULL
         AND right(regexp_replace(s.phone, '\\D', '', 'g'), 10) = i.phone_key
       ORDER BY s.is_active DESC, s.id
       LIMIT 1
    ) st ON true`;

function toInquiry(r: InquiryRow): SiteInquiry {
  const hasLater = r.last_at !== null;
  const details = (hasLater ? r.last_details : r.details) ?? {};
  const message = hasLater ? r.last_message : r.message;
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    suspectReason: r.suspect_reason,
    fullName: r.full_name,
    phone: r.phone,
    email: (hasLater ? r.last_email : null) ?? r.email,
    message,
    details,
    summary: inquirySummary(r.kind, details, message),
    page: r.page,
    duplicateOf: r.duplicate_of,
    createdAt: r.created_at,
    submissionCount: 1 + Number(r.duplicate_count ?? 0),
    lastSubmittedAt: r.last_at ?? r.created_at,
    notifiedAt: r.notified_at,
    handledBy: r.handled_by ? { id: r.handled_by, name: r.handled_by_name ?? "" } : null,
    handledAt: r.handled_at,
    note: r.note,
    updatedAt: r.updated_at,
    student: r.student_id ? { id: r.student_id, fullName: r.student_name ?? "" } : null,
    origin: r.origin ?? null,
  };
}

export type InquiryCounts = { new: number; contacted: number; suspect: number };

export async function inquiryCounts(): Promise<InquiryCounts> {
  const { rows } = await pool.query<{ new: string; contacted: string; suspect: string }>(
    `SELECT count(*) FILTER (WHERE status = 'new' AND suspect_reason IS NULL)     AS new,
            count(*) FILTER (WHERE status = 'contacted')                         AS contacted,
            count(*) FILTER (WHERE status = 'new' AND suspect_reason IS NOT NULL) AS suspect
       FROM site_inquiries
      WHERE duplicate_of IS NULL`,
  );
  return {
    new: Number(rows[0]?.new ?? 0),
    contacted: Number(rows[0]?.contacted ?? 0),
    suspect: Number(rows[0]?.suspect ?? 0),
  };
}

export async function listSiteInquiries(query: {
  box?: unknown;
  kind?: unknown;
  limit?: unknown;
  before?: unknown;
}): Promise<{ items: SiteInquiry[]; counts: InquiryCounts; nextBefore: string | null }> {
  const box: InquiryBox = (INQUIRY_BOXES as readonly string[]).includes(String(query.box ?? ""))
    ? (query.box as InquiryBox)
    : "new";
  const where = [BOX_WHERE[box], `i.duplicate_of IS NULL`];
  const values: unknown[] = [];
  if (query.kind !== undefined && query.kind !== "") {
    if (!(INQUIRY_KINDS as readonly string[]).includes(String(query.kind))) {
      throw new ValidationError("Bilinmeyen talep türü.");
    }
    values.push(String(query.kind));
    where.push(`i.kind = $${values.length}`);
  }
  if (query.before !== undefined && query.before !== "") {
    const before = Number(query.before);
    if (!Number.isInteger(before) || before <= 0) throw new ValidationError("Geçersiz sayfa imleci.");
    values.push(before);
    where.push(`i.id < $${values.length}`);
  }
  const limitRaw = Number(query.limit ?? 50);
  const limit = Number.isInteger(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50;
  values.push(limit + 1);

  const { rows } = await pool.query<InquiryRow>(
    `${SELECT_INQUIRY}
      WHERE ${where.join(" AND ")}
      ORDER BY i.id DESC
      LIMIT $${values.length}`,
    values,
  );
  const page = rows.slice(0, limit).map(toInquiry);
  return {
    items: page,
    counts: await inquiryCounts(),
    nextBefore: rows.length > limit ? page[page.length - 1].id : null,
  };
}

export class SiteInquiryNotFoundError extends AppError {
  constructor() {
    super("SITE_INQUIRY_NOT_FOUND", "Talep bulunamadı.", 404);
  }
}

export type InquirySubmission = {
  id: string;
  createdAt: string;
  summary: string;
  message: string | null;
  details: Record<string, unknown>;
};

export type SiteInquiryDetail = SiteInquiry & {
  // Bu talebin kendi gönderimleri (ilk + tekrarlar), eskiden yeniye.
  submissions: InquirySubmission[];
  // Aynı telefondan gelen DİĞER talepler (başka form ya da 24 saatten eski), en yeni 20.
  related: SiteInquiry[];
};

export async function getSiteInquiry(id: string): Promise<SiteInquiryDetail> {
  const { rows } = await pool.query<InquiryRow>(`${SELECT_INQUIRY} WHERE i.id = $1`, [id]);
  const row = rows[0];
  if (!row) throw new SiteInquiryNotFoundError();
  const head = row.duplicate_of ?? row.id;

  const thread = await pool.query<{
    id: string;
    kind: string;
    created_at: string;
    details: Record<string, unknown>;
    message: string | null;
  }>(
    `SELECT id, kind, created_at::text, details, message
       FROM site_inquiries
      WHERE id = $1 OR duplicate_of = $1
      ORDER BY id`,
    [head],
  );
  const related = await pool.query<InquiryRow>(
    `${SELECT_INQUIRY}
      WHERE i.phone_key = (SELECT phone_key FROM site_inquiries WHERE id = $1)
        AND i.id <> $1
        AND i.duplicate_of IS NULL
      ORDER BY i.id DESC
      LIMIT 20`,
    [head],
  );

  return {
    ...toInquiry(row),
    submissions: thread.rows.map((t) => ({
      id: t.id,
      createdAt: t.created_at,
      summary: inquirySummary(t.kind, t.details ?? {}, t.message),
      message: t.message,
      details: t.details ?? {},
    })),
    related: related.rows.map(toInquiry),
  };
}

/**
 * Panelden güncelleme. status değişince işleyen kişi ve zaman yazılır.
 * suspect:false → "şüpheli değil" (bildirim yine gitmez; insan zaten gördü).
 */
export async function updateSiteInquiry(
  id: string,
  patch: Record<string, unknown>,
  userId: string,
): Promise<SiteInquiryDetail> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.status !== undefined) {
    if (!(INQUIRY_STATUSES as readonly string[]).includes(String(patch.status))) {
      throw new ValidationError("Geçersiz durum.");
    }
    values.push(patch.status);
    const p = `$${values.length}`;
    values.push(userId);
    const u = `$${values.length}`;
    sets.push(`handled_by = CASE WHEN status IS DISTINCT FROM ${p} THEN ${u}::bigint ELSE handled_by END`);
    sets.push(`handled_at = CASE WHEN status IS DISTINCT FROM ${p} THEN now() ELSE handled_at END`);
    sets.push(`status = ${p}`);
  }

  if (patch.note !== undefined) {
    if (patch.note !== null && typeof patch.note !== "string") throw new ValidationError("Not metin olmalı.");
    const note = patch.note === null ? null : cleanText(patch.note, 2000, true);
    values.push(note);
    sets.push(`note = $${values.length}`);
  }

  if (patch.suspect !== undefined) {
    if (patch.suspect !== false) throw new ValidationError("Şüpheli işareti yalnız kaldırılabilir.");
    sets.push(`suspect_reason = NULL`);
  }

  if (sets.length === 0) throw new ValidationError("Değiştirilecek alan yok.");

  values.push(id);
  const { rowCount } = await pool.query(
    `UPDATE site_inquiries SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
    values,
  );
  if (!rowCount) throw new SiteInquiryNotFoundError();
  return getSiteInquiry(id);
}
