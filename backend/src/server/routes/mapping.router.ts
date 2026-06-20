// v1.6 — Ürün eşleştirme kokpiti uçları (iç katalog ↔ Trendyol ↔ Hepsiburada).
// Dış API çağrısı yok (snapshot + channel_listings üzerinde çalışır).
// marketplace_sync_enabled arkasında. Auth: requireAuth (global gate).

import { Router } from "express";

import {
  adoptChannelProduct,
  autoMatchByBarcode,
  getMappingOverview,
} from "../../services/trendyol/channel-mapping.service.js";
import { sendError } from "../middleware/response.js";

export const mappingRouter = Router();

// GET /mapping — kokpit verisi (iç ürünler + TY/HB eşlemeleri + orphan TY ürünleri)
mappingRouter.get("/", async (_req, res) => {
  try {
    const data = await getMappingOverview();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /mapping/auto-match — barkodu eşleşen iç ürünleri TY'ye toplu bağla.
// → { matched, links }
mappingRouter.post("/auto-match", async (req, res) => {
  try {
    const data = await autoMatchByBarcode(req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /mapping/adopt — orphan TY ürününü iç kataloga benimse.
// body: { channelProductId, mode: 'link'|'create', productId?, name?, price? }
mappingRouter.post("/adopt", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mode = body.mode === "create" ? "create" : "link";
    const data = await adoptChannelProduct({
      channelProductId: String(body.channelProductId ?? ""),
      mode,
      productId: body.productId === undefined || body.productId === null || body.productId === ""
        ? null
        : String(body.productId),
      name: typeof body.name === "string" ? body.name : null,
      price: body.price === undefined || body.price === null || body.price === ""
        ? null
        : (body.price as number | string),
      actorUserId: req.currentUser.id,
    });
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
