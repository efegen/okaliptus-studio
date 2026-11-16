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
import {
  changeHepsiburadaCargoCompany,
  getHepsiburadaCargoChangeStatuses,
  getHepsiburadaCargoOptions,
} from "../../services/hepsiburada/order-cargo.service.js";
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

// GET /hepsiburada/orders/cargo-options?packageId=… — paketin geçebileceği aktif kargo
// firmaları (HB'nin o paket için döndürdüğü liste) + mevcut firmanın kodu. Salt-okuma.
// → { packageId, options: [{ code, name, logoUrl }], currentCode }
hepsiburadaRouter.get("/orders/cargo-options", async (req, res) => {
  try {
    const raw = Array.isArray(req.query.packageId) ? req.query.packageId[0] : req.query.packageId;
    const data = await getHepsiburadaCargoOptions(String(raw ?? ""));
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /hepsiburada/orders/cargo-company — paketin kargo firmasını DEĞİŞTİR.
// CANLI HB YAZMASI; marketplaceFulfillmentEnabled kapalıysa 409; kod o paketin aktif
// seçeneklerinden biri değilse 422. body: { packageId, cargoCompany, orderNumber? }
// (cargoCompany = HB kısa kod, ör. "AR"). → { packageId, cargoProvider, name, change, order }
hepsiburadaRouter.post("/orders/cargo-company", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await changeHepsiburadaCargoCompany({
      packageId: body.packageId ? String(body.packageId) : "",
      cargoCompany: body.cargoCompany ? String(body.cargoCompany) : "",
      orderNumber: body.orderNumber ? String(body.orderNumber) : null,
    });
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /hepsiburada/orders/cargo-changes?packageIds=1,2[&check=1] — kargo firması
// değişikliklerinin durumu (pending | applied | unconfirmed) + en taze paket verisi.
// → [{ packageId, change, order }]
hepsiburadaRouter.get("/orders/cargo-changes", async (req, res) => {
  try {
    const raw = req.query.packageIds;
    const packageIds = (Array.isArray(raw) ? raw.join(",") : String(raw ?? "")).split(",");
    const check = req.query.check === "1" || req.query.check === "true";
    const data = await getHepsiburadaCargoChangeStatuses(packageIds, { check });
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
