// Web sitesi mağazası.
//
// GET /site/products — sitenin build sırasında okuduğu liste. Oturum İSTEMEZ,
//   onun yerine `Authorization: Bearer <SITE_FEED_TOKEN>` ister. Anahtar
//   tanımlı değilse uç yokmuş gibi 404 döner. Parametre almaz; sabit bir sorgu
//   çalıştırır. Tarayıcıdan okunması gerekmez, CORS izni verilmez.
//
// GET/PATCH /site-products — panelin "Site mağazası" ekranı (requireAuth +
//   marketplace.manage, app.ts'te mount edilir).

import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";

import {
  getSiteFeed,
  isSiteFeedAuthorized,
  listSiteProducts,
  siteFeedToken,
  updateSiteProduct,
} from "../../services/site-catalog.service.js";
import { sendError } from "../middleware/response.js";

// Site günde birkaç kez okur; 15 dakikada 30 istek fazlasıyla yeter.
export const siteFeedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Çok fazla istek." } },
});

export async function siteFeedHandler(req: Request, res: Response): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  const token = siteFeedToken();
  if (!token) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Bulunamadı." } });
    return;
  }
  if (!isSiteFeedAuthorized(req.headers.authorization, token)) {
    console.warn(`[site-feed] reddedildi (${req.ip ?? "?"})`);
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Yetkisiz." } });
    return;
  }

  try {
    res.json({ data: await getSiteFeed() });
  } catch (err) {
    sendError(res, err);
  }
}

export const siteProductsRouter = Router();

// GET /site-products → { syncedAt, products }
siteProductsRouter.get("/", async (_req, res) => {
  try {
    res.json({ data: await listSiteProducts() });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /site-products/:key — body: { hidden?, corner?, displayName? }
siteProductsRouter.patch("/:key", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const field of ["hidden", "corner", "displayName"]) {
      if (field in body) patch[field] = body[field];
    }
    res.json({ data: await updateSiteProduct(req.params.key, patch, req.currentUser.id) });
  } catch (err) {
    sendError(res, err);
  }
});
