// v1.6 — Trendyol manuel sipariş önizleme ucu (read-only).
//
// POST /trendyol/orders/preview — siparişleri GET ile çekip iç ürünlerle
// eşleştirilmiş ÖNİZLEME döndürür. Hiçbir kayıt yazmaz, hiçbir yazma isteği
// yapmaz. marketplace_sync_enabled kapalıysa 409, kimlik yoksa 503 döner.
// Otomatik poller/cron YOK; yalnız bu manuel uç + UI butonu tetikler.
// Auth: requireAuth (app.ts global gate).

import { Router } from "express";

import { previewTrendyolOrders } from "../../services/trendyol/orders.service.js";
import { syncTrendyolProducts } from "../../services/trendyol/channel-sync.service.js";
import {
  syncTrendyolOrders,
  getOrderReviewQueue,
  resolveOrderReviewItem,
} from "../../services/trendyol/order-sync.service.js";
import { syncTrendyolClaims } from "../../services/trendyol/claims-sync.service.js";
import { sendError } from "../middleware/response.js";

export const trendyolRouter = Router();

// POST /trendyol/products/sync — Trendyol onaylı ürünlerini (read-only) çekip
// channel_products snapshot'ına yazar. Manuel; poller yok. → { synced, pages, pruned }
trendyolRouter.post("/products/sync", async (_req, res) => {
  try {
    const data = await syncTrendyolProducts();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /trendyol/orders/preview
// body (hepsi opsiyonel): { status?, startDate?, endDate?, page?, size? }
trendyolRouter.post("/orders/preview", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const toNum = (v: unknown): number | undefined => {
      if (v === undefined || v === null || v === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const data = await previewTrendyolOrders({
      status: typeof body.status === "string" && body.status ? body.status : undefined,
      startDate: toNum(body.startDate),
      endDate: toNum(body.endDate),
      page: toNum(body.page),
      size: toNum(body.size),
    });
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// ── Model C / Faz 1: sipariş → stok senkronu + inceleme kuyruğu ──────────────

// POST /trendyol/orders/sync — siparişleri çekip iç stoğu uzlaştırır (poller'ın
// manuel ikizi). Trendyol'a YAZMAZ. Flag kapalıysa 409. → sync özeti
trendyolRouter.post("/orders/sync", async (_req, res) => {
  try {
    const data = await syncTrendyolOrders();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /trendyol/claims/sync — iadeleri (claims) çekip ilgili sayılmış sipariş
// satırlarını "iade bekliyor"a taşır (inceleme kuyruğunu besler). Trendyol'a
// YAZMAZ, stok hareketi YAZMAZ (Model C: operatör elle ekler). Flag kapalıysa 409.
trendyolRouter.post("/claims/sync", async (_req, res) => {
  try {
    const data = await syncTrendyolClaims();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /trendyol/orders/review — açık inceleme kuyruğu (iade bekleyen + eşleşmeyen).
trendyolRouter.get("/orders/review", async (_req, res) => {
  try {
    const data = await getOrderReviewQueue();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /trendyol/orders/review/:id/resolve — bir kuyruk kalemini çözüldü işaretle
// (operatör iadeyi setStock'la ekledikten / eşleşmeyeni inceledikten sonra).
// Stoğa dokunmaz; yalnız kuyruktan çıkarır.
trendyolRouter.post("/orders/review/:id/resolve", async (req, res) => {
  try {
    const data = await resolveOrderReviewItem(req.params.id, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
