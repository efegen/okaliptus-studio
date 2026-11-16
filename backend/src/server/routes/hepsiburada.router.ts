// Hepsiburada pazaryeri uçları.
//
// GET /hepsiburada/orders/list — Siparişler ekranı için HB siparişleri, Trendyol
// listesiyle (GET /trendyol/orders/list) AYNI biçimde: { orders[], tabCounts,
// total, configured }. SALT-OKUMA; HB'ye yazmaz, stoğa dokunmaz.
// marketplaceSyncEnabled kapalıysa 409; HB kimliği yoksa boş liste (configured:false).
// query (opsiyonel): startDate, endDate (ms epoch), windowDays, force=1.
// Auth: requireAuth (global) + marketplace.manage (app.ts).

import { Router } from "express";

import { listHepsiburadaOrders } from "../../services/hepsiburada/orders.service.js";
import { sendError } from "../middleware/response.js";

export const hepsiburadaRouter = Router();

function toNum(v: unknown): number | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

hepsiburadaRouter.get("/orders/list", async (req, res) => {
  try {
    const data = await listHepsiburadaOrders({
      startDate: toNum(req.query.startDate),
      endDate: toNum(req.query.endDate),
      windowDays: toNum(req.query.windowDays),
      force: req.query.force === "1" || req.query.force === "true",
    });
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
