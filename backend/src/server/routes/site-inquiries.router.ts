// Web sitesi formları (bkz. services/site-inquiries.service.ts, migration 0296).
//
// POST /public/inquiries — sitenin üç formu. OTURUMSUZ ve ÇEREZSİZ; panelin
//   CORS/CSRF katmanından ÖNCE, kendi CORS listesiyle bağlanır (app.ts). Sitenin
//   adresi ALLOWED_ORIGINS'e EKLENMEZ: oradaki adresler panelin çerezli
//   isteklerini yapabilir.
//   Katmanlar (ucuzdan pahalıya; veritabanına yalnız hepsini geçen dokunur):
//     1. Kapatma anahtarı (SITE_FORMS_ENABLED=false → 404).
//     2. Origin: tarayıcıdan geliyorsa sitenin adresi olmalı (değilse 403).
//     3. IP başına sert sınır: 10 dakikada 20, günde 60 → 429.
//     4. IP başına yumuşak sınır: 10 dakikada 5'ten sonrası REDDEDİLMEZ,
//        "şüpheli" kaydedilir (aynı ağı paylaşan gerçek kişiler kaybolmasın).
//     5. 16 KB gövde, sıkı şema (servis).
//     6. Tuzak alan, doldurma süresi, Origin yokluğu → şüpheli (servis).
//     7. Günlük tavanlar ve isteğe bağlı Turnstile (servis).
//   Yanıt her başarılı yolda aynıdır (201 {received:true}): şüpheli de olsa,
//   tekrar da olsa. Bot neye takıldığını öğrenmez.
//   IP: app.ts'teki "trust proxy 1" (Railway'in kenar proxy'si) + clientIp.ts.
//   API Cloudflare'de turuncu bulut olursa req.ip, istek Cloudflare aralığından
//   geldiği için CF-Connecting-IP'deki gerçek ziyaretçiyle değiştirilir; sınırlar
//   yine kişi başı çalışır.
//
// GET/PATCH /site-inquiries — panelin "Talepler" ekranı (requireAuth +
//   inquiries.manage, app.ts'te bağlanır).

import express, { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";

import {
  classifySubmission,
  getSiteInquiry,
  InquiryValidationError,
  inquiryCounts,
  listSiteInquiries,
  parseSubmission,
  receiveInquiry,
  SiteFormsBusyError,
  siteFormSettings,
  updateSiteInquiry,
  type SiteFormSettings,
} from "../../services/site-inquiries.service.js";
import { publishWrite } from "../../services/live-sync.service.js";
import { alertSiteFormsBusy, notifySiteInquiriesNow } from "../../services/notification-scheduler.js";
import { parseId, sendError } from "../middleware/response.js";

const RATE_LIMITED = {
  error: {
    code: "RATE_LIMITED",
    message: "Çok sık gönderim yapıldı. Lütfen biraz sonra tekrar deneyin ya da telefonla ulaşın.",
  },
};

// ─── Oturumsuz uç ────────────────────────────────────────────────────────────
export const publicFormsRouter = Router();

function siteCors(req: Request, res: Response, next: NextFunction): void {
  const settings = siteFormSettings();
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  if (!settings.enabled) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Bulunamadı." } });
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    if (!settings.origins.has(origin)) {
      console.warn(`[site-forms] izinsiz kaynak reddedildi: ${origin.slice(0, 100)}`);
      res.status(403).json({ error: { code: "FORBIDDEN_ORIGIN", message: "Geçersiz kaynak." } });
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    // Tarayıcı ön kontrolü 2 saat hatırlar; ikinci gönderim beklemeden gider.
    res.setHeader("Access-Control-Max-Age", "7200");
    res.status(204).end();
    return;
  }

  res.locals.siteForms = settings;
  next();
}

publicFormsRouter.use(siteCors);

const perDay = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: RATE_LIMITED,
});

const perTenMinutes = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: false,
  legacyHeaders: false,
  message: RATE_LIMITED,
});

// Yumuşak sınır: aşan istek geçer ama "burst" işaretiyle şüpheli kaydedilir.
const burstMarker = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (_req, res, next) => {
    res.locals.burst = true;
    next();
  },
});

// text/plain de kabul edilir: site ileride ön kontrolsüz (preflight'sız) basit
// istek göndermek isterse sunucu değişmeden çalışsın.
const parseBody = express.json({ limit: "16kb", type: ["application/json", "text/plain"] });

publicFormsRouter.post("/inquiries", perDay, perTenMinutes, burstMarker, parseBody, async (req, res) => {
  const settings = res.locals.siteForms as SiteFormSettings;

  let parsed;
  try {
    parsed = parseSubmission(req.body);
  } catch (err) {
    if (err instanceof InquiryValidationError) {
      res.status(422).json({ error: { code: err.code, message: err.message, fields: err.fields } });
      return;
    }
    sendError(res, err);
    return;
  }

  const suspect = classifySubmission(
    parsed,
    { hasOrigin: Boolean(req.headers.origin), burst: res.locals.burst === true },
    settings.minFillMs,
  );

  try {
    const result = await receiveInquiry({ parsed, suspect, ip: req.ip, settings });
    res.status(201).json({ data: { received: true } });

    if (result.outcome === "stored") {
      // Kişisel veri loglanmaz; yalnız kimlik ve tür.
      console.info(`[site-forms] talep #${result.id} (${parsed.input.kind}${result.notify ? "" : ", bildirimsiz"})`);
      publishWrite("POST", "/site-inquiries");
      if (result.notify) notifySiteInquiriesNow();
    }
  } catch (err) {
    if (err instanceof SiteFormsBusyError) {
      console.warn("[site-forms] günlük tavan doldu, gönderim alınmadı.");
      alertSiteFormsBusy();
    }
    sendError(res, err);
  }
});

publicFormsRouter.use((_req: Request, res: Response) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Bulunamadı." } });
});

// Gövde okunamazsa (bozuk JSON, 16 KB üstü) panelin genel hata biçimiyle döner.
publicFormsRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const type = (err as { type?: string }).type;
  if (type === "entity.too.large") {
    res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Gönderim çok büyük." } });
    return;
  }
  if (type === "entity.parse.failed" || type === "encoding.unsupported" || type === "charset.unsupported") {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "Geçersiz istek." } });
    return;
  }
  sendError(res, err);
});

// ─── Panel ───────────────────────────────────────────────────────────────────
export const siteInquiriesRouter = Router();

// GET /site-inquiries?box=new|contacted|done|suspect|spam|all&kind=&limit=&before=
//   → { items, counts, nextBefore }
siteInquiriesRouter.get("/", async (req, res) => {
  try {
    res.json({ data: await listSiteInquiries(req.query) });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /site-inquiries/counts → { new, contacted, suspect } (rozetler için)
siteInquiriesRouter.get("/counts", async (_req, res) => {
  try {
    res.json({ data: await inquiryCounts() });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /site-inquiries/:id → talep + aynı telefondan gelen diğerleri
siteInquiriesRouter.get("/:id", async (req, res) => {
  try {
    res.json({ data: await getSiteInquiry(parseId(req.params.id)) });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /site-inquiries/:id — body: { status?, note?, suspect?: false }
siteInquiriesRouter.patch("/:id", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const field of ["status", "note", "suspect"]) {
      if (field in body) patch[field] = body[field];
    }
    res.json({ data: await updateSiteInquiry(parseId(req.params.id), patch, req.currentUser.id) });
  } catch (err) {
    sendError(res, err);
  }
});
