// v1.6 — Trendyol manuel sipariş önizleme ucu (read-only).
//
// POST /trendyol/orders/preview — siparişleri GET ile çekip iç ürünlerle
// eşleştirilmiş ÖNİZLEME döndürür. Hiçbir kayıt yazmaz, hiçbir yazma isteği
// yapmaz. marketplace_sync_enabled kapalıysa 409, kimlik yoksa 503 döner.
// Otomatik poller/cron YOK; yalnız bu manuel uç + UI butonu tetikler.
// Auth: requireAuth (app.ts global gate).

import { Router } from "express";

import { previewTrendyolOrders, listTrendyolOrders } from "../../services/trendyol/orders.service.js";
import { syncTrendyolProducts } from "../../services/trendyol/channel-sync.service.js";
import {
  syncTrendyolOrders,
  getOrderReviewQueue,
  resolveOrderReviewItem,
} from "../../services/trendyol/order-sync.service.js";
import { syncTrendyolClaims } from "../../services/trendyol/claims-sync.service.js";
import { getOrderCargoLabel } from "../../services/trendyol/order-label.service.js";
import { changeOrderCargoProvider } from "../../services/trendyol/order-cargo.service.js";
import {
  baselineChannelListings,
  runStockPush,
  getStockPushStatus,
} from "../../services/trendyol/stock-push.service.js";
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

// GET /trendyol/orders/list — Pazaryeri Siparişleri ekranı için zenginleştirilmiş
// (TY fotoğrafı + iç ürün eşleşmesi) sipariş listesi + sekme sayıları. SALT-OKUMA;
// stoğa DOKUNMAZ (order-sync defterinden bağımsız). marketplace_sync kapalıysa 409.
// query (opsiyonel): startDate, endDate (ms epoch), windowDays.
trendyolRouter.get("/orders/list", async (req, res) => {
  try {
    const toNum = (v: unknown): number | undefined => {
      const raw = Array.isArray(v) ? v[0] : v;
      if (raw === undefined || raw === null || raw === "") return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    const force = req.query.force === "1" || req.query.force === "true";
    const data = await listTrendyolOrders({
      startDate: toNum(req.query.startDate),
      endDate: toNum(req.query.endDate),
      windowDays: toNum(req.query.windowDays),
      force,
    });
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /trendyol/orders/label — Faz 2: kargo etiketi (Ortak Etiket) OLUŞTUR + getir.
// CANLI TY YAZMASI; marketplace_fulfillment kapalıysa 409. body: { cargoTrackingNumber,
// format?: "ZPL" | "PDF" (default ZPL) }. → { contentType, base64|text|json, format, … }
trendyolRouter.post("/orders/label", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ctn = body.cargoTrackingNumber ? String(body.cargoTrackingNumber) : "";
    const format = body.format === "PDF" ? "PDF" : "ZPL";
    const data = await getOrderCargoLabel(ctn, format);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /trendyol/orders/cargo-provider — Faz 2: paketin kargo firmasını DEĞİŞTİR.
// CANLI TY YAZMASI; marketplace_fulfillment kapalıysa 409. body: { packageId,
// cargoProvider } (cargoProvider = TY firma KODU, whitelist). → { packageId, cargoProvider, name }
trendyolRouter.post("/orders/cargo-provider", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await changeOrderCargoProvider({
      packageId: body.packageId ? String(body.packageId) : "",
      cargoProvider: body.cargoProvider ? String(body.cargoProvider) : "",
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

// ── Model C / Faz 2: iç stoğu Trendyol'a PUSH (yazma) ────────────────────────

// POST /trendyol/stock/baseline — her eşli ürünün iç açılış stoğunu o anki TY
// adedine hizalar ve last_pushed = TY adedi işaretler (push'un ön koşulu). Trendyol'a
// YAZMAZ (yalnız iç stok + işaret). body: { force?: boolean }. → baseline özeti
trendyolRouter.post("/stock/baseline", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await baselineChannelListings({
      force: body.force === true,
      actorUserId: req.currentUser.id,
    });
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /trendyol/stock/push — iç efektif stoğu TY'ye gönderir (poller'ın manuel
// ikizi). Kill switch (marketplace_stock_push_enabled) kapalıysa 409. dry-run açıkken
// yalnız plan döner, TY'ye yazmaz. body:
//   { force?: boolean }         → devre kesiciyi aş (toplu reconcile)
//   { productId, live: true }   → KASITLI tek-ürün CANLI yazma (dry-run'ı aşar; ilk
//                                 gerçek yazma bununla yapılır). live olmadan productId
//                                 = yalnız o ürünü reconcile (dry-run'a saygı).
// → push sonucu { mode, pushedCount, failedCount, items, breaker, … }
trendyolRouter.post("/stock/push", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const productId =
      body.productId === undefined || body.productId === null || body.productId === ""
        ? null
        : String(body.productId);
    const data = await runStockPush({
      force: body.force === true,
      onlyProductId: productId,
      overrideDryRun: body.live === true,
      actorUserId: req.currentUser.id,
    });
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /trendyol/stock/status — baseline durumu + push önizlemesi (değişecek kalemler)
// + push hataları + flag'ler. Salt-okuma; TY'ye dokunmaz.
trendyolRouter.get("/stock/status", async (_req, res) => {
  try {
    const data = await getStockPushStatus();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
