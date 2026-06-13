// v1.6 — Trendyol manuel sipariş önizleme ucu (read-only).
//
// POST /trendyol/orders/preview — siparişleri GET ile çekip iç ürünlerle
// eşleştirilmiş ÖNİZLEME döndürür. Hiçbir kayıt yazmaz, hiçbir yazma isteği
// yapmaz. marketplace_sync_enabled kapalıysa 409, kimlik yoksa 503 döner.
// Otomatik poller/cron YOK; yalnız bu manuel uç + UI butonu tetikler.
// Auth: requireAuth (app.ts global gate).

import { Router } from "express";

import { previewTrendyolOrders } from "../../services/trendyol/orders.service.js";
import { sendError } from "../middleware/response.js";

export const trendyolRouter = Router();

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
