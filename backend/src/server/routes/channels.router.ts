// v1.6 — Kanal eşleştirme: listing-id bazlı route'lar (PUT/DELETE /channels/:id).
// Ürün-bazlı route'lar (GET/POST /products/:id/channels) products.router'da.
// Auth: requireAuth → currentUser.id (app.ts'te global mount edilir).
// + GET /channels/insights — iki pazaryerinin birleşik özeti (salt-okuma).

import { Router } from "express";

import {
  removeChannelListing,
  updateChannelListing,
} from "../../services/channel-listings.service.js";
import { getMarketplaceInsights } from "../../services/marketplace-insights.service.js";
import { parseInsightPeriod } from "../../services/trendyol/insights.service.js";
import { parseId, sendError } from "../middleware/response.js";
import { requireCan } from "../middleware/requireRole.js";

export const channelsRouter = Router();

// GET /channels/insights?period=hafta|ay|gecen — mobil Siparişler ekranının özet
// şeridi + detayları, Trendyol + Hepsiburada birleşik ve kanal başına (byChannel):
// satış, sana kalan (komisyon / kargo / KDV / kesintiler), en çok satanlar, ödemeler.
// SALT-OKUMA. Finansal veri → ayrıca finance.read. marketplace_sync kapalıysa 409.
channelsRouter.get("/insights", requireCan("finance.read"), async (req, res) => {
  try {
    const period = parseInsightPeriod(req.query.period);
    const data = await getMarketplaceInsights(period);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// PUT /channels/:id — fiyat / listeli durumu güncelle
// body: { channelPrice?, isListed? }
channelsRouter.put("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body as Record<string, unknown>;
    const patch: Parameters<typeof updateChannelListing>[1] = { actorUserId: req.currentUser.id };
    if ("channelPrice" in body) {
      patch.channelPrice =
        body.channelPrice === null || body.channelPrice === "" ? null : (body.channelPrice as string | number);
    }
    if ("isListed" in body) {
      patch.isListed = !!body.isListed;
    }
    const data = await updateChannelListing(id, patch);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /channels/:id
channelsRouter.delete("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await removeChannelListing(id, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
