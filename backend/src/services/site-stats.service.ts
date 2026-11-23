// Web sitesi ziyaret istatistikleri → panel "Site" ekranı (bkz. migration 0297).
//
// Site (okaliptusyoga.com) her sayfadan POST /public/pulse'a küçük sinyaller
// yollar (bkz. routes/site-stats.router.ts):
//   view  → sayfa açıldı (yol, başlık, geldiği adres, kampanya etiketleri)
//   ping  → sekme önde, 15 saniyede bir (o ana kadarki süre, kaydırma, bölümler)
//   leave → sekme arkaya alındı ya da kapandı (son değerler)
//   event → tıklama, form adımı, video, galeri
//
// GİZLİLİK (onay bandı gerektirmemesi buna bağlı; değiştirmeden önce sor):
//   - Çerez yok, cihaza hiçbir şey yazılmaz; sayfa kimliği yalnız o sayfa açıkken
//     tarayıcının belleğinde durur.
//   - IP saklanmaz ve loglanmaz. Yalnız ili bulmak (site-geo.service.ts, ağ
//     çağrısı yok) ve günlük ziyaretçi anahtarını üretmek için bellekte kullanılır.
//   - Ziyaretçi anahtarı = sha256(günün tuzu + IP + tarayıcı kimliği). Tuz her
//     gün değişir, eskisi silinir: ertesi gün aynı kişi tanınmaz.
//   - Reklam tıklama kimlikleri (fbclid/gclid) alınmaz; site yalnız "vardı" der.
//
// YÜK (panel aynı süreçte çalışır; istatistik paneli asla bekletmemeli):
//   - Uç hemen 204 döner; işleme tek sıralı bir kuyrukta, arkada yapılır.
//     Kuyruk dolarsa (QUEUE_LIMIT) yeni sinyaller sessizce düşer.
//   - ping veritabanına yazmaz: bellekte tutulur, FLUSH_MS'de bir toplu yazılır.
//   - Günlük sayfa tavanı (SITE_STATS_DAILY_VIEWS, 20 000): aşılırsa o günün
//     yeni sayfaları kaydedilmez.
//   - Botlar (tarayıcı kimliğine göre) hiç kaydedilmez.
//
// TEK SÜREÇ VARSAYIMI: anlık ziyaretçi listesi ve kuyruk süreç içi bellektedir.

import { createHash, randomBytes } from "node:crypto";

import { pool } from "../db/connection.js";
import { env } from "../config/env.js";
import { geoEdition, regionOfIp } from "./site-geo.service.js";
import { purgeExpiredInquiries } from "./site-inquiries.service.js";
import { ValidationError } from "./errors.js";

// ─── Sabitler ────────────────────────────────────────────────────────────────
const VISIT_GAP_MS = 30 * 60 * 1000;
const LIVE_WINDOW_MS = 45 * 1000;
const FLUSH_MS = 20 * 1000;
const MAINTENANCE_MS = 6 * 60 * 60 * 1000;
const RETENTION_DAYS = 90;
const QUEUE_LIMIT = 500;
const MAX_ACTIVE_MS = 4 * 60 * 60 * 1000;

export const EVENT_NAMES = [
  "click",
  "form_open",
  "form_start",
  "form_submit",
  "form_error",
  "form_close",
  "video_play",
  "gallery_open",
  "not_found",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const AI_SOURCES = ["chatgpt", "perplexity", "gemini", "claude", "copilot"] as const;

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function siteStatsEnabled(): boolean {
  return (process.env.SITE_STATS_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

// ─── Sinyal ayrıştırma ───────────────────────────────────────────────────────
type Utm = { source: string | null; medium: string | null; campaign: string | null; content: string | null; term: string | null };

export type Signal =
  | {
      type: "view";
      pageId: string;
      path: string;
      title: string | null;
      referrer: string | null;
      utm: Utm;
      mark: "meta" | "google" | null;
      screenW: number | null;
      lang: string | null;
    }
  | {
      type: "ping" | "leave";
      pageId: string;
      activeMs: number;
      scroll: number;
      sections: string[];
      lcp: number | null;
    }
  | { type: "event"; pageId: string; name: EventName; label: string | null };

const PAGE_ID_RE = /^[a-z0-9]{8,32}$/i;
const SECTION_RE = /^[a-z0-9_-]{1,40}$/i;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const points = [...s];
  return points.length > max ? points.slice(0, max).join("") : s;
}

function int(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Yalnız yol: sorgu ve çapa atılır ("/dersler?x=1#form" → "/dersler"). */
function cleanPath(value: unknown): string | null {
  const raw = text(value, 300);
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  let p = raw.split(/[?#]/)[0];
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p.slice(0, 200) || "/";
}

/** Bozuk ya da tanınmayan gövde → null (sessizce düşer). */
export function parseSignal(body: unknown): Signal | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const pageId = typeof b.p === "string" && PAGE_ID_RE.test(b.p) ? b.p.toLowerCase() : null;
  if (!pageId) return null;

  if (b.t === "view") {
    const path = cleanPath(b.u);
    if (!path) return null;
    const q = (b.q && typeof b.q === "object" ? b.q : {}) as Record<string, unknown>;
    return {
      type: "view",
      pageId,
      path,
      title: text(b.h, 120),
      referrer: text(b.r, 300),
      utm: {
        source: text(q.us, 80),
        medium: text(q.um, 80),
        campaign: text(q.uc, 120),
        content: text(q.un, 120),
        term: text(q.ut, 120),
      },
      mark: q.m === "meta" || q.m === "google" ? q.m : null,
      screenW: int(b.w, 0, 10_000),
      lang: text(b.l, 16),
    };
  }

  if (b.t === "ping" || b.t === "leave") {
    const sections = Array.isArray(b.x)
      ? [...new Set(b.x.filter((s): s is string => typeof s === "string" && SECTION_RE.test(s)).map((s) => s.toLowerCase()))].slice(0, 30)
      : [];
    return {
      type: b.t,
      pageId,
      activeMs: int(b.a, 0, MAX_ACTIVE_MS) ?? 0,
      scroll: int(b.s, 0, 100) ?? 0,
      sections,
      lcp: b.c === undefined || b.c === null ? null : int(b.c, 0, 60_000),
    };
  }

  if (b.t === "event") {
    if (typeof b.n !== "string" || !(EVENT_NAMES as readonly string[]).includes(b.n)) return null;
    return { type: "event", pageId, name: b.n as EventName, label: text(b.k, 80) };
  }

  return null;
}

// ─── Tarayıcı kimliği ────────────────────────────────────────────────────────
const BOT_RE =
  /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|pingdom|uptime|monitor|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|axios|go-http|okhttp|java\/|\bnode\b|scrapy|phantom|selenium|puppeteer|playwright/i;

export function isBotAgent(ua: string | undefined | null): boolean {
  const s = String(ua ?? "");
  return s.length < 20 || BOT_RE.test(s);
}

export type Device = "phone" | "tablet" | "desktop";

export function describeAgent(ua: string): { device: Device; os: string | null; browser: string | null } {
  const device: Device = /iPad|Tablet|PlayBook|Silk/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
    ? "tablet"
    : /Mobi|iPhone|iPod|Android/.test(ua)
      ? "phone"
      : "desktop";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  const browser = /Instagram/.test(ua)
    ? "Instagram"
    : /FBAN|FBAV|FB_IAB/.test(ua)
      ? "Facebook"
      : /EdgA?\/|EdgiOS/.test(ua)
        ? "Edge"
        : /SamsungBrowser/.test(ua)
          ? "Samsung Internet"
          : /OPR\/|Opera/.test(ua)
            ? "Opera"
            : /YaBrowser/.test(ua)
              ? "Yandex"
              : /Firefox|FxiOS/.test(ua)
                ? "Firefox"
                : /CriOS|Chrome/.test(ua)
                  ? "Chrome"
                  : /Safari/.test(ua)
                    ? "Safari"
                    : null;
  return { device, os, browser };
}

// ─── Kaynak sınıflandırma ────────────────────────────────────────────────────
const OWN_HOSTS = new Set(["okaliptusyoga.com", "www.okaliptusyoga.com", "localhost", "127.0.0.1"]);
const PAID_MEDIUM_RE = /^(paid|cpc|ppc|cpm|ads?|reklam|paid[-_ ]?social|paidsocial|sponsored)$/;

function hostOf(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

function aiSourceOf(s: string): string | null {
  if (/chatgpt|openai/.test(s)) return "chatgpt";
  if (/perplexity/.test(s)) return "perplexity";
  if (/gemini\.google|bard\.google|^gemini$/.test(s)) return "gemini";
  if (/claude\.ai|^claude$|anthropic/.test(s)) return "claude";
  if (/copilot/.test(s)) return "copilot";
  return null;
}

/**
 * Ziyaretin kaynağı. "_ad" yalnız bağlantıdaki etiket ücretli diyorsa verilir
 * (utm_medium=paid gibi): Meta'nın tıklama işareti (fbclid) reklam dışı
 * bağlantılara da eklendiği için tek başına reklam sayılmaz.
 */
export function classifySource(input: {
  referrer: string | null;
  utm: Utm;
  mark: "meta" | "google" | null;
  ua: string;
}): { source: string; referrerHost: string | null } {
  const rawHost = hostOf(input.referrer);
  const host = rawHost && !OWN_HOSTS.has(rawHost) && !OWN_HOSTS.has(`www.${rawHost}`) ? rawHost : null;
  const us = (input.utm.source ?? "").toLowerCase();
  const um = (input.utm.medium ?? "").toLowerCase();
  const paid = PAID_MEDIUM_RE.test(um);

  const ai = aiSourceOf(us) ?? (host ? aiSourceOf(host) : null);
  if (ai) return { source: ai, referrerHost: host };

  let family: "instagram" | "facebook" | "google" | null = null;
  if (/^(ig|instagram)$/.test(us) || /instagram/.test(us)) family = "instagram";
  else if (/^(fb|facebook|meta|an|msg|messenger)$/.test(us) || /facebook/.test(us)) family = "facebook";
  else if (/google/.test(us)) family = "google";
  else if (host && /(^|\.)instagram\.com$/.test(host)) family = "instagram";
  else if (host && /(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/.test(host)) family = "facebook";
  else if (host && /(^|\.)google\.[a-z.]+$/.test(host)) family = "google";

  // Sitenin kendi sayfasından gelindiyse (iç gezinme) tarayıcıya bakılmaz.
  const internal = rawHost !== null && host === null;
  if (!family && !us && !host && !internal) {
    // Uygulama içi tarayıcılar geldiği adresi çoğu zaman vermez.
    if (/Instagram/.test(input.ua)) family = "instagram";
    else if (/FBAN|FBAV|FB_IAB/.test(input.ua)) family = "facebook";
    else if (input.mark === "meta") family = "facebook";
    else if (input.mark === "google") family = "google";
  }

  if (family === "instagram" || family === "facebook") {
    return { source: paid ? `${family}_ad` : family, referrerHost: host };
  }
  if (family === "google") {
    return { source: paid || input.mark === "google" ? "google_ad" : "google", referrerHost: host };
  }
  if (host) {
    if (/(^|\.)bing\.com$/.test(host)) return { source: "bing", referrerHost: host };
    if (/(^|\.)yandex\./.test(host)) return { source: "yandex", referrerHost: host };
    if (/(^|\.)duckduckgo\.com$/.test(host)) return { source: "duckduckgo", referrerHost: host };
    return { source: "other", referrerHost: host };
  }
  return { source: us ? "other" : "direct", referrerHost: null };
}

// ─── Gün ve tuz ──────────────────────────────────────────────────────────────
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: env.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });

export function todayKey(now: Date = new Date()): string {
  return dayFormat.format(now);
}

let saltCache: { day: string; salt: string } | null = null;

async function saltFor(day: string): Promise<string> {
  if (saltCache?.day === day) return saltCache.salt;
  const { rows } = await pool.query<{ salt: string }>(
    `INSERT INTO site_stat_salts (day, salt) VALUES ($1, $2)
     ON CONFLICT (day) DO UPDATE SET salt = site_stat_salts.salt
     RETURNING salt`,
    [day, randomBytes(32).toString("hex")],
  );
  // Eski günlerin tuzu silinir: o günlerin anahtarları artık hiçbir IP'yle eşlenemez.
  await pool.query(`DELETE FROM site_stat_salts WHERE day < $1`, [day]);
  saltCache = { day, salt: rows[0].salt };
  return rows[0].salt;
}

async function visitorKeyOf(ip: string, ua: string, day: string): Promise<string> {
  const salt = await saltFor(day);
  return createHash("sha256").update(`${salt}\n${ip}\n${ua}`).digest("hex").slice(0, 40);
}

// ─── Bellek durumu ───────────────────────────────────────────────────────────
type LiveVisit = {
  id: string;
  visitorKey: string;
  source: string;
  campaign: string | null;
  content: string | null;
  medium: string | null;
  clickMark: string | null;
  referrerHost: string | null;
  region: string | null;
  device: Device;
  browser: string | null;
  startedAt: number;
  lastSeen: number;
  savedLastSeen: number;
  trail: Array<{ path: string; title: string | null }>;
};

type LivePage = {
  pageId: string;
  pageviewId: string;
  visit: LiveVisit;
  path: string;
  title: string | null;
  startedAt: number;
  lastSeen: number;
  visible: boolean;
  activeMs: number;
  scroll: number;
  sections: Set<string>;
  lcp: number | null;
  dirty: boolean;
  formOpen: string | null;
};

const visitsByKey = new Map<string, LiveVisit>();
const pagesById = new Map<string, LivePage>();
let viewsToday = { day: "", count: 0 };

// ─── Kuyruk ──────────────────────────────────────────────────────────────────
let chain: Promise<void> = Promise.resolve();
let pending = 0;

function enqueue(job: () => Promise<void>): boolean {
  if (pending >= QUEUE_LIMIT) return false;
  pending++;
  chain = chain
    .then(job)
    .catch((err) => {
      // Kişisel veri loglanmaz; yalnız hata.
      console.warn(`[site-stats] sinyal işlenemedi: ${(err as Error).message}`);
    })
    .finally(() => {
      pending--;
    });
  return true;
}

/** Kuyruktaki işler bitene kadar bekler (testler ve okuma öncesi tazeleme). */
export function siteStatsIdle(): Promise<void> {
  return chain;
}

// ─── Sinyal işleme ───────────────────────────────────────────────────────────
export type SignalContext = { ip: string; ua: string };

/**
 * Sinyali kuyruğa alır; hemen döner. false → alınmadı (bot, kapalı, kuyruk dolu).
 * Çağıran her durumda aynı yanıtı verir.
 */
export function acceptSignal(signal: Signal, ctx: SignalContext): boolean {
  if (!siteStatsEnabled() || isBotAgent(ctx.ua)) return false;
  return enqueue(() => handle(signal, ctx, Date.now()));
}

async function handle(signal: Signal, ctx: SignalContext, now: number): Promise<void> {
  const day = todayKey(new Date(now));
  const key = await visitorKeyOf(ctx.ip, ctx.ua, day);
  if (signal.type === "view") return handleView(signal, ctx, key, day, now);

  const page = await pageFor(signal.pageId, key);
  if (!page) return;
  page.lastSeen = now;
  page.visit.lastSeen = now;

  if (signal.type === "event") {
    if (signal.name === "form_open") page.formOpen = signal.label ?? "form";
    if (signal.name === "form_close" || signal.name === "form_submit") page.formOpen = null;
    await pool.query(`INSERT INTO site_events (visit_id, pageview_id, name, label) VALUES ($1, $2, $3, $4)`, [
      page.visit.id,
      page.pageviewId,
      signal.name,
      signal.label,
    ]);
    return;
  }

  if (signal.activeMs > page.activeMs) page.activeMs = signal.activeMs;
  if (signal.scroll > page.scroll) page.scroll = signal.scroll;
  for (const s of signal.sections) page.sections.add(s);
  if (page.lcp === null && signal.lcp !== null) page.lcp = signal.lcp;
  page.dirty = true;
  page.visible = signal.type === "ping";
  if (signal.type === "leave") await flushPages([page]);
}

async function handleView(
  signal: Extract<Signal, { type: "view" }>,
  ctx: SignalContext,
  key: string,
  day: string,
  now: number,
): Promise<void> {
  if (pagesById.has(signal.pageId)) return;

  if (viewsToday.day !== day) viewsToday = { day, count: 0 };
  if (viewsToday.count >= intEnv("SITE_STATS_DAILY_VIEWS", 20_000, 0, 1_000_000)) return;
  viewsToday.count++;

  const { source, referrerHost } = classifySource({ referrer: signal.referrer, utm: signal.utm, mark: signal.mark, ua: ctx.ua });
  let visit = await visitFor(key, now);

  // Aynı kişi yarım saat içinde BAŞKA bir kaynaktan ya da başka bir reklamdan
  // yeniden geldiyse yeni ziyaret sayılır (iç gezinme "direct" görünür, ziyareti bölmez).
  // "Yeniden geldi" yalnız bağlantının kendisi söylüyorsa sayılır (kampanya
  // etiketi ya da başka sitenin adresi); tarayıcı türünden çıkarılan kaynak
  // ziyareti bölmez (uygulama içi tarayıcılar iç gezinmede adres vermeyebilir).
  const external = source !== "direct" && (signal.utm.source !== null || referrerHost !== null);
  if (
    visit &&
    external &&
    (visit.source !== source || visit.campaign !== signal.utm.campaign || visit.content !== signal.utm.content)
  ) {
    visit = null;
  }

  if (!visit) {
    const agent = describeAgent(ctx.ua);
    const region = regionOfIp(ctx.ip);
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO site_visits
         (visitor_key, day, source, referrer_host, utm_source, utm_medium, utm_campaign, utm_content,
          utm_term, click_mark, region, device, os, browser, lang, screen_w, entry_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id`,
      [
        key, day, source, referrerHost, signal.utm.source, signal.utm.medium, signal.utm.campaign,
        signal.utm.content, signal.utm.term, signal.mark, region, agent.device, agent.os, agent.browser,
        signal.lang, signal.screenW, signal.path,
      ],
    );
    visit = {
      id: inserted.rows[0].id,
      visitorKey: key,
      source,
      campaign: signal.utm.campaign,
      content: signal.utm.content,
      medium: signal.utm.medium,
      clickMark: signal.mark,
      referrerHost,
      region,
      device: agent.device,
      browser: agent.browser,
      startedAt: now,
      lastSeen: now,
      savedLastSeen: now,
      trail: [],
    };
    visitsByKey.set(key, visit);
  }

  const pv = await pool.query<{ id: string }>(
    `INSERT INTO site_pageviews (visit_id, page_id, path, title) VALUES ($1, $2, $3, $4)
     ON CONFLICT (page_id) DO NOTHING
     RETURNING id`,
    [visit.id, signal.pageId, signal.path, signal.title],
  );
  if (!pv.rows[0]) return;

  visit.lastSeen = now;
  visit.trail.push({ path: signal.path, title: signal.title });
  if (visit.trail.length > 30) visit.trail.shift();
  pagesById.set(signal.pageId, {
    pageId: signal.pageId,
    pageviewId: pv.rows[0].id,
    visit,
    path: signal.path,
    title: signal.title,
    startedAt: now,
    lastSeen: now,
    visible: true,
    activeMs: 0,
    scroll: 0,
    sections: new Set(),
    lcp: null,
    dirty: false,
    formOpen: null,
  });
}

type VisitRow = {
  id: string;
  source: string;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_medium: string | null;
  click_mark: string | null;
  referrer_host: string | null;
  region: string | null;
  device: Device;
  browser: string | null;
  started_ms: string;
  last_ms: string;
};

const VISIT_COLUMNS = `id, source, utm_campaign, utm_content, utm_medium, click_mark, referrer_host, region,
  device, browser, (extract(epoch FROM started_at) * 1000)::bigint AS started_ms,
  (extract(epoch FROM last_seen_at) * 1000)::bigint AS last_ms`;

function visitFromRow(r: VisitRow, key: string): LiveVisit {
  return {
    id: r.id,
    visitorKey: key,
    source: r.source,
    campaign: r.utm_campaign,
    content: r.utm_content,
    medium: r.utm_medium,
    clickMark: r.click_mark,
    referrerHost: r.referrer_host,
    region: r.region,
    device: r.device,
    browser: r.browser,
    startedAt: Number(r.started_ms),
    lastSeen: Number(r.last_ms),
    savedLastSeen: Number(r.last_ms),
    trail: [],
  };
}

/** Bu anahtarın süren ziyareti (bellekte, yoksa veritabanında; yeniden başlatma sonrası). */
async function visitFor(key: string, now: number): Promise<LiveVisit | null> {
  const cached = visitsByKey.get(key);
  if (cached) {
    if (now - cached.lastSeen <= VISIT_GAP_MS) return cached;
    visitsByKey.delete(key);
    return null;
  }
  const { rows } = await pool.query<VisitRow>(
    `SELECT ${VISIT_COLUMNS}
       FROM site_visits
      WHERE visitor_key = $1 AND last_seen_at > now() - make_interval(secs => $2)
      ORDER BY id DESC
      LIMIT 1`,
    [key, VISIT_GAP_MS / 1000],
  );
  if (!rows[0]) return null;
  const visit = visitFromRow(rows[0], key);
  const trail = await pool.query<{ path: string; title: string | null }>(
    `SELECT path, title FROM site_pageviews WHERE visit_id = $1 ORDER BY id`,
    [visit.id],
  );
  visit.trail = trail.rows.slice(-30);
  visitsByKey.set(key, visit);
  return visit;
}

/**
 * Sinyalin bağlanacağı sayfa. Bellekte yoksa (yeniden başlatma) veritabanından
 * geri yüklenir; yalnız AYNI ziyaretçi anahtarına aitse (başkasının sayfa
 * kimliğini tahmin eden biri onun satırını değiştiremez).
 */
async function pageFor(pageId: string, key: string): Promise<LivePage | null> {
  const cached = pagesById.get(pageId);
  if (cached) return cached.visit.visitorKey === key ? cached : null;

  const { rows } = await pool.query<{
    id: string;
    visit_id: string;
    path: string;
    title: string | null;
    active_ms: number;
    max_scroll: number;
    sections: string[];
    lcp_ms: number | null;
    started_ms: string;
  }>(
    `SELECT p.id, p.visit_id, p.path, p.title, p.active_ms, p.max_scroll, p.sections, p.lcp_ms,
            (extract(epoch FROM p.started_at) * 1000)::bigint AS started_ms
       FROM site_pageviews p
       JOIN site_visits v ON v.id = p.visit_id
      WHERE p.page_id = $1 AND v.visitor_key = $2 AND p.started_at > now() - interval '6 hours'`,
    [pageId, key],
  );
  const r = rows[0];
  if (!r) return null;

  let visit = visitsByKey.get(key);
  if (!visit || visit.id !== r.visit_id) {
    const v = await pool.query<VisitRow>(`SELECT ${VISIT_COLUMNS} FROM site_visits WHERE id = $1`, [r.visit_id]);
    if (!v.rows[0]) return null;
    visit = visitFromRow(v.rows[0], key);
    const trail = await pool.query<{ path: string; title: string | null }>(
      `SELECT path, title FROM site_pageviews WHERE visit_id = $1 ORDER BY id`,
      [visit.id],
    );
    visit.trail = trail.rows.slice(-30);
    visitsByKey.set(key, visit);
  }
  const page: LivePage = {
    pageId,
    pageviewId: r.id,
    visit,
    path: r.path,
    title: r.title,
    startedAt: Number(r.started_ms),
    lastSeen: Date.now(),
    visible: true,
    activeMs: r.active_ms,
    scroll: r.max_scroll,
    sections: new Set(r.sections ?? []),
    lcp: r.lcp_ms,
    dirty: false,
    formOpen: null,
  };
  pagesById.set(pageId, page);
  return page;
}

// ─── Belleği veritabanına yazma ──────────────────────────────────────────────
async function flushPages(pages: LivePage[]): Promise<void> {
  const visits = new Set<LiveVisit>();
  for (const page of pages) {
    visits.add(page.visit);
    if (!page.dirty) continue;
    page.dirty = false;
    await pool.query(
      `UPDATE site_pageviews
          SET active_ms = GREATEST(active_ms, $2),
              max_scroll = GREATEST(max_scroll, $3),
              sections = $4,
              lcp_ms = COALESCE(lcp_ms, $5)
        WHERE id = $1`,
      [page.pageviewId, page.activeMs, page.scroll, [...page.sections], page.lcp],
    );
  }
  for (const visit of visits) {
    if (visit.lastSeen <= visit.savedLastSeen) continue;
    visit.savedLastSeen = visit.lastSeen;
    await pool.query(`UPDATE site_visits SET last_seen_at = to_timestamp($2::double precision / 1000) WHERE id = $1`, [
      visit.id,
      visit.lastSeen,
    ]);
  }
}

/** Bekleyen süre/kaydırma değerlerini yazar ve eskiyen bellek kayıtlarını atar. */
export function flushSiteStats(): Promise<void> {
  enqueue(async () => {
    await flushPages([...pagesById.values()]);
    const cutoff = Date.now() - VISIT_GAP_MS - 5 * 60 * 1000;
    for (const [id, page] of pagesById) if (page.lastSeen < cutoff) pagesById.delete(id);
    for (const [key, visit] of visitsByKey) if (visit.lastSeen < cutoff) visitsByKey.delete(key);
  });
  return chain;
}

// ─── Zamanlayıcı ─────────────────────────────────────────────────────────────
let flushTimer: NodeJS.Timeout | null = null;
let maintenanceTimer: NodeJS.Timeout | null = null;

export function startSiteStats(): void {
  if (maintenanceTimer) return;
  // Bakım (özet, eski ziyaretler, süresi dolan talepler) ölçüm kapalıyken de
  // çalışır: taleplerin saklama süresi ölçüme bağlı değildir.
  if (siteStatsEnabled()) {
    flushTimer = setInterval(() => void flushSiteStats(), FLUSH_MS);
    flushTimer.unref();
  }
  const maintain = () => void runSiteStatsMaintenance().catch((err) => console.warn(`[site-stats] bakım başarısız: ${(err as Error).message}`));
  maintenanceTimer = setInterval(maintain, MAINTENANCE_MS);
  maintenanceTimer.unref();
  setTimeout(maintain, 60 * 1000).unref();
}

export async function stopSiteStats(): Promise<void> {
  if (flushTimer) clearInterval(flushTimer);
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  flushTimer = null;
  maintenanceTimer = null;
  // Kapanırken bekleyen süreler kaybolmasın (en fazla birkaç yazma).
  await Promise.race([flushSiteStats(), new Promise((resolve) => setTimeout(resolve, 3000))]).catch(() => {});
}

/** Yalnız testler: bellek durumunu sıfırlar ("yeniden başlatma" benzetimi). */
export function resetSiteStatsMemory(): void {
  visitsByKey.clear();
  pagesById.clear();
  saltCache = null;
  viewsToday = { day: "", count: 0 };
}

// ─── Bakım: günlük özet + 90 günden eski ham satırlar ────────────────────────
const DAILY_DIMS: Array<{ dim: string; key: string }> = [
  { dim: "total", key: `''` },
  { dim: "source", key: `v.source` },
  { dim: "region", key: `COALESCE(v.region, '')` },
  { dim: "device", key: `v.device` },
  { dim: "campaign", key: `COALESCE(v.utm_campaign, '') || ' / ' || COALESCE(v.utm_content, '')` },
];

export async function runSiteStatsMaintenance(): Promise<void> {
  const today = todayKey();
  for (const { dim, key } of DAILY_DIMS) {
    const where = dim === "campaign" ? `AND v.source LIKE '%\\_ad'` : "";
    await pool.query(
      `INSERT INTO site_stats_daily (day, dim, key, visitors, visits, pageviews, active_ms)
       SELECT v.day, $2::text, (${key})::text AS key, count(DISTINCT v.visitor_key), count(DISTINCT v.id),
              count(p.id), COALESCE(sum(p.active_ms), 0)
         FROM site_visits v
         LEFT JOIN site_pageviews p ON p.visit_id = v.id
        WHERE v.day >= $1::date - 3 AND v.day < $1::date ${where}
        GROUP BY v.day, key
       ON CONFLICT (day, dim, key) DO UPDATE
         SET visitors = EXCLUDED.visitors, visits = EXCLUDED.visits,
             pageviews = EXCLUDED.pageviews, active_ms = EXCLUDED.active_ms`,
      [today, dim],
    );
  }
  await pool.query(
    `INSERT INTO site_stats_daily (day, dim, key, visitors, visits, pageviews, active_ms)
     SELECT v.day, 'path', p.path, count(DISTINCT v.visitor_key), count(DISTINCT v.id),
            count(p.id), COALESCE(sum(p.active_ms), 0)
       FROM site_pageviews p
       JOIN site_visits v ON v.id = p.visit_id
      WHERE v.day >= $1::date - 3 AND v.day < $1::date
      GROUP BY v.day, p.path
     ON CONFLICT (day, dim, key) DO UPDATE
       SET visitors = EXCLUDED.visitors, visits = EXCLUDED.visits,
           pageviews = EXCLUDED.pageviews, active_ms = EXCLUDED.active_ms`,
    [today],
  );
  await pool.query(`DELETE FROM site_visits WHERE day < $1::date - $2::int`, [today, RETENTION_DAYS]);
  // Form talepleri: gizlilik sayfasında söz verilen süre (bkz. site-inquiries.service.ts).
  await purgeExpiredInquiries();
}

// ─── Talebin geldiği ziyaret ─────────────────────────────────────────────────
export type InquiryOrigin = {
  source: string;
  referrerHost: string | null;
  campaign: string | null;
  content: string | null;
  medium: string | null;
  clickMark: string | null;
  region: string | null;
  device: Device;
  browser: string | null;
  startedAt: string;
  durationMs: number;
  pages: Array<{ path: string; title: string | null; activeMs: number }>;
};

/**
 * Form gönderen tarayıcının süren ziyaretinin özetini talebe yazar. Ziyaret
 * bulunamazsa (izleme kapalı, engellenmiş, bot) hiçbir şey yazmaz. Hata formu
 * etkilemez: çağıran sonucu beklemez.
 */
export async function attachInquiryOrigin(inquiryId: string, ctx: SignalContext): Promise<void> {
  if (!siteStatsEnabled() || isBotAgent(ctx.ua)) return;
  await flushSiteStats();
  const now = Date.now();
  const key = await visitorKeyOf(ctx.ip, ctx.ua, todayKey(new Date(now)));
  const visit = await visitFor(key, now);
  if (!visit) return;
  const pages = await pool.query<{ path: string; title: string | null; active_ms: number }>(
    `SELECT path, title, active_ms FROM site_pageviews WHERE visit_id = $1 ORDER BY id LIMIT 40`,
    [visit.id],
  );
  const origin: InquiryOrigin = {
    source: visit.source,
    referrerHost: visit.referrerHost,
    campaign: visit.campaign,
    content: visit.content,
    medium: visit.medium,
    clickMark: visit.clickMark,
    region: visit.region,
    device: visit.device,
    browser: visit.browser,
    startedAt: new Date(visit.startedAt).toISOString(),
    durationMs: Math.max(0, now - visit.startedAt),
    pages: pages.rows.map((p) => ({ path: p.path, title: p.title, activeMs: p.active_ms })),
  };
  await pool.query(`UPDATE site_inquiries SET origin = $2::jsonb WHERE id = $1 AND origin IS NULL`, [
    inquiryId,
    JSON.stringify(origin),
  ]);
}

// ─── Panel: şu an sitede ─────────────────────────────────────────────────────
export type LiveVisitor = {
  path: string;
  title: string | null;
  source: string;
  referrerHost: string | null;
  campaign: string | null;
  content: string | null;
  clickMark: string | null;
  region: string | null;
  device: Device;
  browser: string | null;
  startedAt: string;
  durationMs: number;
  formOpen: string | null;
  // Bu sayfadan önce gezdikleri (eskiden yeniye, en fazla 5).
  trail: Array<{ path: string; title: string | null }>;
};

export function liveSiteVisitors(now: number = Date.now()): {
  count: number;
  visitors: LiveVisitor[];
  pages: Array<{ path: string; title: string | null; count: number }>;
} {
  const cutoff = now - LIVE_WINDOW_MS;
  const latest = new Map<LiveVisit, LivePage>();
  for (const page of pagesById.values()) {
    if (!page.visible || page.lastSeen < cutoff) continue;
    const current = latest.get(page.visit);
    if (!current || page.lastSeen > current.lastSeen) latest.set(page.visit, page);
  }
  const visitors: LiveVisitor[] = [...latest.entries()]
    .sort((a, b) => a[0].startedAt - b[0].startedAt)
    .map(([visit, page]) => ({
      path: page.path,
      title: page.title,
      source: visit.source,
      referrerHost: visit.referrerHost,
      campaign: visit.campaign,
      content: visit.content,
      clickMark: visit.clickMark,
      region: visit.region,
      device: visit.device,
      browser: visit.browser,
      startedAt: new Date(visit.startedAt).toISOString(),
      durationMs: Math.max(0, now - visit.startedAt),
      formOpen: page.formOpen,
      trail: visit.trail.slice(0, -1).slice(-5),
    }));
  const byPath = new Map<string, { path: string; title: string | null; count: number }>();
  for (const v of visitors) {
    const entry = byPath.get(v.path) ?? { path: v.path, title: v.title, count: 0 };
    entry.count++;
    byPath.set(v.path, entry);
  }
  return {
    count: visitors.length,
    visitors,
    pages: [...byPath.values()].sort((a, b) => b.count - a.count),
  };
}

// ─── Panel: özet ─────────────────────────────────────────────────────────────
export const STAT_PERIODS = { today: 1, "7d": 7, "30d": 30 } as const;
export type StatPeriod = keyof typeof STAT_PERIODS;

type Num = string | number | null;
const n = (v: Num): number => Number(v ?? 0);

export async function siteStatsOverview(periodRaw: unknown) {
  const period = (periodRaw === undefined || periodRaw === "" ? "7d" : String(periodRaw)) as StatPeriod;
  if (!(period in STAT_PERIODS)) throw new ValidationError("Geçersiz dönem.");
  await flushSiteStats();

  const days = STAT_PERIODS[period];
  const today = todayKey();
  // $1 = bugün, $2 = dönemin gün sayısı. Dönem: [bugün - (gün-1), bugün].
  const range = `v.day > $1::date - $2::int AND v.day <= $1::date`;
  const args = [today, days];

  const totals = await pool.query<{ visitors: Num; visits: Num; pageviews: Num; active_ms: Num }>(
    `SELECT count(DISTINCT v.visitor_key) AS visitors, count(DISTINCT v.id) AS visits,
            count(p.id) AS pageviews, COALESCE(sum(p.active_ms), 0) AS active_ms
       FROM site_visits v LEFT JOIN site_pageviews p ON p.visit_id = v.id
      WHERE ${range}`,
    args,
  );
  const previous = await pool.query<{ visitors: Num }>(
    `SELECT count(DISTINCT visitor_key) AS visitors
       FROM site_visits
      WHERE day > $1::date - 2 * $2::int AND day <= $1::date - $2::int`,
    args,
  );

  const seriesDays = Math.max(7, days);
  const series = await pool.query<{ day: string; visitors: Num; pageviews: Num }>(
    `SELECT d::date::text AS day,
            (SELECT count(DISTINCT visitor_key) FROM site_visits v WHERE v.day = d::date) AS visitors,
            (SELECT count(*) FROM site_pageviews p JOIN site_visits v ON v.id = p.visit_id WHERE v.day = d::date) AS pageviews
       FROM generate_series($1::date - ($2::int - 1), $1::date, interval '1 day') d
      ORDER BY d`,
    [today, seriesDays],
  );

  const pages = await pool.query<{
    path: string;
    title: string | null;
    views: Num;
    visits: Num;
    active_ms: Num;
    scroll: Num;
  }>(
    `SELECT p.path,
            (array_agg(p.title ORDER BY p.id DESC) FILTER (WHERE p.title IS NOT NULL))[1] AS title,
            count(*) AS views, count(DISTINCT p.visit_id) AS visits,
            COALESCE(avg(p.active_ms), 0) AS active_ms, COALESCE(avg(p.max_scroll), 0) AS scroll
       FROM site_pageviews p JOIN site_visits v ON v.id = p.visit_id
      WHERE ${range}
      GROUP BY p.path
      ORDER BY count(*) DESC, p.path
      LIMIT 15`,
    args,
  );
  const pageSections = await pool.query<{ path: string; section: string; visits: Num }>(
    `SELECT p.path, s.section, count(DISTINCT p.visit_id) AS visits
       FROM site_pageviews p
       JOIN site_visits v ON v.id = p.visit_id
       CROSS JOIN LATERAL unnest(p.sections) AS s(section)
      WHERE ${range}
      GROUP BY p.path, s.section`,
    args,
  );

  const regions = await pool.query<{ region: string | null; visitors: Num }>(
    `SELECT v.region, count(DISTINCT v.visitor_key) AS visitors
       FROM site_visits v WHERE ${range}
      GROUP BY v.region ORDER BY count(DISTINCT v.visitor_key) DESC`,
    args,
  );
  const devices = await pool.query<{ device: Device; visitors: Num }>(
    `SELECT v.device, count(DISTINCT v.visitor_key) AS visitors
       FROM site_visits v WHERE ${range}
      GROUP BY v.device ORDER BY count(DISTINCT v.visitor_key) DESC`,
    args,
  );
  const speed = await pool.query<{ device: Device; lcp_ms: Num; samples: Num }>(
    `SELECT v.device, percentile_cont(0.5) WITHIN GROUP (ORDER BY p.lcp_ms) AS lcp_ms, count(*) AS samples
       FROM site_pageviews p JOIN site_visits v ON v.id = p.visit_id
      WHERE ${range} AND p.lcp_ms IS NOT NULL
      GROUP BY v.device`,
    args,
  );

  const sources = await pool.query<{
    source: string;
    visitors: Num;
    visits: Num;
    active_ms: Num;
    top_path: string | null;
    top_title: string | null;
  }>(
    `SELECT s.source, s.visitors, s.visits, s.active_ms, t.path AS top_path, t.title AS top_title
       FROM (
         SELECT v.source, count(DISTINCT v.visitor_key) AS visitors, count(DISTINCT v.id) AS visits,
                COALESCE(sum(p.active_ms), 0) AS active_ms
           FROM site_visits v LEFT JOIN site_pageviews p ON p.visit_id = v.id
          WHERE ${range}
          GROUP BY v.source
       ) s
       LEFT JOIN LATERAL (
         SELECT p.path, max(p.title) AS title
           FROM site_pageviews p JOIN site_visits v ON v.id = p.visit_id
          WHERE ${range} AND v.source = s.source
          GROUP BY p.path
          ORDER BY count(*) DESC, p.path
          LIMIT 1
       ) t ON true
      ORDER BY s.visitors DESC, s.source`,
    args,
  );

  // Reklam dışı Instagram/Facebook ziyaretlerinde hangi bağlantı (etikete göre).
  const links = await pool.query<{ source: string; label: string | null; marked: boolean; visitors: Num }>(
    `SELECT v.source, COALESCE(v.utm_content, v.utm_campaign, v.utm_medium) AS label,
            (v.click_mark IS NOT NULL) AS marked, count(DISTINCT v.visitor_key) AS visitors
       FROM site_visits v
      WHERE ${range} AND v.source IN ('instagram', 'facebook')
      GROUP BY 1, 2, 3
      ORDER BY count(DISTINCT v.visitor_key) DESC`,
    args,
  );

  const ads = await pool.query<{
    source: string;
    campaign: string | null;
    content: string | null;
    visitors: Num;
    visits: Num;
    active_ms: Num;
    form_open: Num;
    form_start: Num;
    form_submit: Num;
  }>(
    `WITH adv AS (
       SELECT v.id, v.visitor_key, v.source, v.utm_campaign, v.utm_content
         FROM site_visits v
        WHERE ${range} AND v.source LIKE '%\\_ad'
     ), pv AS (
       SELECT visit_id, sum(active_ms) AS active_ms
         FROM site_pageviews WHERE visit_id IN (SELECT id FROM adv) GROUP BY visit_id
     ), ev AS (
       SELECT visit_id, bool_or(name = 'form_open') AS opened, bool_or(name = 'form_start') AS started,
              bool_or(name = 'form_submit') AS submitted
         FROM site_events WHERE visit_id IN (SELECT id FROM adv) GROUP BY visit_id
     )
     SELECT a.source, a.utm_campaign AS campaign, a.utm_content AS content,
            count(DISTINCT a.visitor_key) AS visitors, count(*) AS visits,
            COALESCE(sum(pv.active_ms), 0) AS active_ms,
            count(*) FILTER (WHERE ev.opened) AS form_open,
            count(*) FILTER (WHERE ev.started) AS form_start,
            count(*) FILTER (WHERE ev.submitted) AS form_submit
       FROM adv a
       LEFT JOIN pv ON pv.visit_id = a.id
       LEFT JOIN ev ON ev.visit_id = a.id
      GROUP BY a.source, a.utm_campaign, a.utm_content
      ORDER BY count(DISTINCT a.visitor_key) DESC`,
    args,
  );
  const adRegions = await pool.query<{ source: string; campaign: string | null; content: string | null; region: string | null; visitors: Num }>(
    `SELECT v.source, v.utm_campaign AS campaign, v.utm_content AS content, v.region,
            count(DISTINCT v.visitor_key) AS visitors
       FROM site_visits v
      WHERE ${range} AND v.source LIKE '%\\_ad'
      GROUP BY 1, 2, 3, 4`,
    args,
  );
  const adSections = await pool.query<{ source: string; campaign: string | null; content: string | null; section: string; visits: Num }>(
    `SELECT v.source, v.utm_campaign AS campaign, v.utm_content AS content, s.section,
            count(DISTINCT v.id) AS visits
       FROM site_visits v
       JOIN site_pageviews p ON p.visit_id = v.id
       CROSS JOIN LATERAL unnest(p.sections) AS s(section)
      WHERE ${range} AND v.source LIKE '%\\_ad'
      GROUP BY 1, 2, 3, 4`,
    args,
  );

  const formEvents = await pool.query<{ label: string | null; name: string; visits: Num }>(
    `SELECT e.label, e.name, count(DISTINCT e.visit_id) AS visits
       FROM site_events e JOIN site_visits v ON v.id = e.visit_id
      WHERE ${range} AND e.name IN ('form_open', 'form_start', 'form_submit', 'form_error')
      GROUP BY e.label, e.name`,
    args,
  );
  const events = await pool.query<{ name: string; label: string | null; count: Num; visits: Num }>(
    `SELECT e.name, e.label, count(*) AS count, count(DISTINCT e.visit_id) AS visits
       FROM site_events e JOIN site_visits v ON v.id = e.visit_id
      WHERE ${range} AND e.name IN ('click', 'video_play', 'gallery_open', 'not_found')
      GROUP BY e.name, e.label
      ORDER BY count(*) DESC
      LIMIT 40`,
    args,
  );

  // Gelen formlar (şüpheli ve tekrar olmayanlar), geldikleri ziyaretin kaynağıyla.
  const inquiries = await pool.query<{ kind: string; source: string | null; campaign: string | null; content: string | null; count: Num }>(
    `SELECT kind, origin->>'source' AS source, origin->>'campaign' AS campaign,
            origin->>'content' AS content, count(*) AS count
       FROM site_inquiries
      WHERE suspect_reason IS NULL AND duplicate_of IS NULL AND status <> 'spam'
        AND (created_at AT TIME ZONE $3)::date > $1::date - $2::int
        AND (created_at AT TIME ZONE $3)::date <= $1::date
      GROUP BY 1, 2, 3, 4`,
    [today, days, env.timeZone],
  );

  const sameAd = (a: { source: string | null; campaign: string | null; content: string | null }, b: typeof a) =>
    a.source === b.source && a.campaign === b.campaign && a.content === b.content;
  const formsBySource = new Map<string, number>();
  const formsByKind: Record<string, number> = {};
  for (const r of inquiries.rows) {
    formsByKind[r.kind] = (formsByKind[r.kind] ?? 0) + n(r.count);
    if (r.source) formsBySource.set(r.source, (formsBySource.get(r.source) ?? 0) + n(r.count));
  }

  const forms: Record<string, { open: number; start: number; submit: number; error: number }> = {};
  for (const r of formEvents.rows) {
    const label = r.label ?? "form";
    forms[label] ??= { open: 0, start: 0, submit: 0, error: 0 };
    const step = r.name.replace("form_", "") as "open" | "start" | "submit" | "error";
    forms[label][step] = n(r.visits);
  }

  const t = totals.rows[0];
  return {
    period,
    days,
    range: { from: series.rows[Math.max(0, series.rows.length - days)]?.day ?? today, to: today },
    totals: {
      visitors: n(t.visitors),
      visits: n(t.visits),
      pageviews: n(t.pageviews),
      avgVisitMs: n(t.visits) ? Math.round(n(t.active_ms) / n(t.visits)) : 0,
      previousVisitors: n(previous.rows[0]?.visitors),
      inquiries: Object.values(formsByKind).reduce((a, b) => a + b, 0),
      inquiriesByKind: formsByKind,
    },
    series: series.rows.map((r) => ({ day: r.day, visitors: n(r.visitors), pageviews: n(r.pageviews) })),
    pages: pages.rows.map((p) => ({
      path: p.path,
      title: p.title,
      views: n(p.views),
      visits: n(p.visits),
      avgActiveMs: Math.round(n(p.active_ms)),
      avgScroll: Math.round(n(p.scroll)),
      sections: Object.fromEntries(pageSections.rows.filter((s) => s.path === p.path).map((s) => [s.section, n(s.visits)])),
    })),
    regions: regions.rows.map((r) => ({ region: r.region, visitors: n(r.visitors) })),
    devices: devices.rows.map((r) => ({ device: r.device, visitors: n(r.visitors) })),
    speed: speed.rows.map((r) => ({ device: r.device, lcpMs: Math.round(n(r.lcp_ms)), samples: n(r.samples) })),
    sources: sources.rows.map((s) => ({
      source: s.source,
      visitors: n(s.visitors),
      visits: n(s.visits),
      avgVisitMs: n(s.visits) ? Math.round(n(s.active_ms) / n(s.visits)) : 0,
      inquiries: formsBySource.get(s.source) ?? 0,
      topPath: s.top_path,
      topTitle: s.top_title,
    })),
    links: links.rows.map((l) => ({ source: l.source, label: l.label, clickMark: l.marked, visitors: n(l.visitors) })),
    ads: ads.rows.map((a) => ({
      source: a.source,
      campaign: a.campaign,
      content: a.content,
      visitors: n(a.visitors),
      visits: n(a.visits),
      avgVisitMs: n(a.visits) ? Math.round(n(a.active_ms) / n(a.visits)) : 0,
      formOpen: n(a.form_open),
      formStart: n(a.form_start),
      formSubmit: n(a.form_submit),
      inquiries: inquiries.rows.filter((i) => sameAd(i, a)).reduce((sum, i) => sum + n(i.count), 0),
      regions: adRegions.rows
        .filter((r) => sameAd(r, a))
        .map((r) => ({ region: r.region, visitors: n(r.visitors) }))
        .sort((x, y) => y.visitors - x.visitors),
      sections: Object.fromEntries(adSections.rows.filter((s) => sameAd(s, a)).map((s) => [s.section, n(s.visits)])),
    })),
    forms,
    events: events.rows.map((e) => ({ name: e.name, label: e.label, count: n(e.count), visits: n(e.visits) })),
    // Yapay zekâ botlarının okumaları sayfa kodundan toplanamaz (kod çalıştırmazlar).
    crawlers: null,
    geo: { edition: geoEdition(), attribution: "IP Geolocation by DB-IP" },
  };
}
