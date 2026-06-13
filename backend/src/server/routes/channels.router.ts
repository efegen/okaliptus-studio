// v1.6 — Kanal eşleştirme: listing-id bazlı route'lar (PUT/DELETE /channels/:id).
// Ürün-bazlı route'lar (GET/POST /products/:id/channels) products.router'da.
// Auth: requireAuth → currentUser.id (app.ts'te global mount edilir).

import { Router } from "express";

import {
  removeChannelListing,
  updateChannelListing,
} from "../../services/channel-listings.service.js";
import { parseId, sendError } from "../middleware/response.js";

export const channelsRouter = Router();

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
