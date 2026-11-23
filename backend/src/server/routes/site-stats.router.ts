// Web sitesi ziyaret istatistikleri (bkz. services/site-stats.service.ts, migration 0297).
//
// POST /public/pulse — sitenin her sayfasından gelen küçük sinyaller. OTURUMSUZ
//   ve ÇEREZSİZ; panelin CORS/CSRF katmanından ÖNCE, sitenin Origin listesiyle
//   bağlanır (formlarla aynı liste: siteFormSettings().origins).
//   - Gövde text/plain JSON'dur: tarayıcı ön kontrol (preflight) yapmaz, sayfa
//     kapanırken de gönderebilir.
//   - Yanıt her durumda 204'tür ve gövdesizdir; işleme arkada yapılır. Bozuk
//     gövde, bot, dolu kuyruk, aşılmış sınır: hepsi sessizce düşer (site hiçbir
//     yanıtı okumaz, ziyaretçi hiçbir şey görmez).
//   - Origin'siz ya da yabancı Origin'li istek 403: yalnız sitenin sayfaları yazar.
//   - IP başına dakikada 240 sinyal; aşan düşer.
//   - Kapatma: SITE_STATS_ENABLED=false → 404.
//
// GET /site-stats/live, /site-stats/overview — panelin "Site" ekranı
//   (requireAuth + site.stats.read, app.ts'te bağlanır).

import express, { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";

import { siteFormSettings } from "../../services/site-inquiries.service.js";
import {
  acceptSignal,
  liveSiteVisitors,
  parseSignal,
  siteStatsEnabled,
  siteStatsIdle,
  siteStatsOverview,
} from "../../services/site-stats.service.js";
import { sendError } from "../middleware/response.js";

// ─── Oturumsuz uç ────────────────────────────────────────────────────────────
export const sitePulseRouter = Router();

sitePulseRouter.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  if (!siteStatsEnabled()) {
    res.status(404).end();
    return;
  }
  const origin = req.headers.origin;
  if (!origin || !siteFormSettings().origins.has(origin)) {
    res.status(403).end();
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "7200");
    res.status(204).end();
    return;
  }
  next();
});

const perMinute = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(204).end();
  },
});

const parseBody = express.text({ limit: "4kb", type: ["text/plain", "application/json"] });

sitePulseRouter.post("/", perMinute, parseBody, (req, res) => {
  res.status(204).end();
  let body: unknown = null;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : null;
  } catch {
    return;
  }
  const signal = parseSignal(body);
  if (!signal) return;
  const agent = req.headers["user-agent"];
  acceptSignal(signal, { ip: req.ip ?? "", ua: typeof agent === "string" ? agent : "" });
});

// Büyük ya da okunamayan gövde de sessizce 204 (ziyaretçi bir şey görmez).
sitePulseRouter.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (!res.headersSent) res.status(204).end();
});

// ─── Panel ───────────────────────────────────────────────────────────────────
export const siteStatsRouter = Router();

// GET /site-stats/live → { count, visitors, pages } (şu an sitede olanlar)
siteStatsRouter.get("/live", async (_req, res) => {
  try {
    await siteStatsIdle();
    res.json({ data: liveSiteVisitors() });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /site-stats/overview?period=today|7d|30d
siteStatsRouter.get("/overview", async (req, res) => {
  try {
    res.json({ data: await siteStatsOverview(req.query.period) });
  } catch (err) {
    sendError(res, err);
  }
});
