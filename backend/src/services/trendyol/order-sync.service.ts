// v1.6 — Model C / Faz 1: Trendyol sipariş → iç stok senkronu (PULL, yazma YOK).
//
// "TY satışı içeri düşmüyor" tutarsızlığını bitirir: siparişler periyodik çekilir,
// her satır iç ürünle eşleştirilir ve stok OTOMATİK düşürülür/iade edilir. Trendyol'a
// hiçbir yazma (stok push) yapılmaz — o Faz 2.
//
// İdempotensi: channel_order_lines defteri (orderNumber+lineId). Poller her turda
// aynı siparişi tekrar görür; bu servis "ne kadar düştüm" (applied_delta) ile yeni
// hedefi karşılaştırıp YALNIZ farkı (adjustDelta) stock_movements'a yazar. Aynı veriyle
// ikinci çalışma no-op'tur.
//
// Stok mantığı (kullanıcı kararı, [[project_marketplace_mapping]] Model C):
//   • Satıldı (Created/Shipped/Delivered…) → iç stok -qty (rezerve).
//   • İptal (Cancelled/UnSupplied)         → düşülen miktar OTOMATİK geri (+).
//   • İade (Returned)                      → OTOMATİK DEĞİL; "iade bekleyenler"
//     kuyruğuna düşer, operatör malı sağlamsa elle setStock'la ekler.
//   • Eşleşmeyen (iç ürün yok)             → "eşleşmeyen sipariş" kuyruğu (sessiz
//     yutma yok); operatör eşleyince sonraki tur otomatik düşer.

import type { PoolClient } from "pg";

import { pool } from "../../db/connection.js";
import { AppError, ValidationError, toServiceError } from "../errors.js";
import { getSettings } from "../settings.service.js";
import { explodeStockDeltas, stockLockKey, type StockDelta } from "../stock.service.js";
import { rollbackQuietly, withAdvisoryLock, type EntityId } from "../shared.js";
import {
  getOrders as defaultGetOrders,
  type GetOrdersParams,
  type TrendyolOrder,
  type TrendyolOrdersResponse,
} from "./client.js";
import { env } from "../../config/env.js";

// Tüm sipariş senkronlarını (poller + manuel uç + çoklu instance) seri hale getiren
// global advisory lock. İdempotensi zaten çift-sayımı önler; bu kilit iki çalışmanın
// aynı anda aynı satıra yazıp yarış oluşturmasını engeller (tek-yazar garantisi).
const ORDER_SYNC_LOCK = "trendyol_order_sync";

export class MarketplaceOrdersDisabledError extends AppError {
  constructor(message = "Pazaryeri sipariş senkronu kapalı. Ayarlardan 'Sipariş senkronu'nu açın.") {
    super("MARKETPLACE_ORDERS_DISABLED", message, 409);
  }
}

// ── TY ham status → bizim niyetimiz ─────────────────────────────────────────
export type OrderCategory = "sold" | "cancelled" | "returned";

export function classifyTrendyolStatus(status: string | null | undefined): OrderCategory {
  const s = (status ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (s === "cancelled" || s === "canceled" || s === "unsupplied") return "cancelled";
  if (s === "returned") return "returned";
  // Created/Picking/Invoiced/Shipped/AtCollectionPoint/Delivered/UnDelivered… → canlı satış.
  // Bilinmeyen status da "satıldı" sayılır: sipariş var demek satış var; yalnız AÇIK
  // iptal/iade'de geri alırız (bilinmeyen ≠ iptal).
  return "sold";
}

export type LineState = "counted" | "reversed" | "return_pending" | "unmatched" | "ignored" | "setup_pending";

// barcode → eşleşen iç ürün. isBundle/hasComponents (Faz 1.5): tanımlanmamış paket
// (bundle ama bileşeni yok) TY satırı 'setup_pending' kuyruğuna düşer, decrement YOK.
export type MatchMap = Map<string, { productId: string; internalName: string; isBundle: boolean; hasComponents: boolean }>;

// Düzleştirilmiş tekil sipariş satırı (saf, ağ/DB yok).
export type IncomingLine = {
  orderNumber: string;
  lineId: string;
  barcode: string | null;
  quantity: number;
  category: OrderCategory;
  channelStatus: string | null;
  customerName: string | null;
  orderDate: number | null; // epoch ms
  raw: unknown;
};

// channel_order_lines'tan yüklenen önceki durum.
export type ExistingLine = {
  id: string;
  state: LineState;
  appliedDelta: number;
  productId: string | null;
};

// Bir satır için planlanan sonuç: yeni defter durumu + (varsa) stok hareketi.
export type LinePlan = {
  key: string;
  existingId: string | null;
  orderNumber: string;
  lineId: string;
  barcode: string | null;
  productId: string | null;   // defter satırına yazılacak ürün (eşleşen ya da önceki)
  quantity: number;
  channelStatus: string | null;
  customerName: string | null;
  orderDate: number | null;
  raw: unknown;
  state: LineState;
  appliedDelta: number;       // bu satırın yeni net stok etkisi (<=0)
  adjustDelta: number;        // appliedDelta - öncekiDelta → stock_movements'a yazılacak
  stockProductId: string | null; // hareketin yazılacağı ürün
};

export type ReconcilePlan = {
  plans: LinePlan[];
  summary: {
    ordersSeen: number;
    linesSeen: number;
    counted: number;
    reversed: number;
    returnPending: number;
    unmatched: number;
    ignored: number;
    setupPending: number;     // tanımlanmamış paket (bileşen bekliyor)
    unitsDecremented: number; // bu turda düşülen toplam adet (bundle ise bileşen adetleri)
    unitsRestored: number;    // bu turda geri eklenen toplam adet
  };
};

function lineKey(orderNumber: string, lineId: string): string {
  return `${orderNumber}::${lineId}`;
}

// Saf çekirdek: gelen satırlar + eşleme tablosu + mevcut defter → plan. DB/ağ YOK,
// bu yüzden tek başına (offline) test edilebilir.
export function planOrderReconciliation(
  incoming: IncomingLine[],
  matchMap: MatchMap,
  existing: Map<string, ExistingLine>,
): ReconcilePlan {
  // Aynı turda dublike anahtar gelirse son görüleni tut (savunmacı).
  const byKey = new Map<string, IncomingLine>();
  for (const line of incoming) byKey.set(lineKey(line.orderNumber, line.lineId), line);

  const plans: LinePlan[] = [];
  const orders = new Set<string>();
  let counted = 0, reversed = 0, returnPending = 0, unmatched = 0, ignored = 0, setupPending = 0;
  let unitsDecremented = 0, unitsRestored = 0;

  for (const [key, line] of byKey) {
    orders.add(line.orderNumber);
    const prior = existing.get(key) ?? null;
    const priorDelta = prior?.appliedDelta ?? 0;
    const matched = line.barcode ? matchMap.get(line.barcode) : undefined;

    let state: LineState;
    let appliedDelta: number;
    let productId: string | null;
    let stockProductId: string | null;

    if (!matched) {
      // Eşleşmeyen. Önceden bir ürüne sayılmışsa (eşleme sonradan kaldırıldı) onu geri al.
      productId = prior?.productId ?? null;
      stockProductId = prior?.productId ?? null;
      appliedDelta = 0;
      if (line.category === "sold") {
        state = "unmatched"; // operatör eşlemeli → kuyrukta
      } else {
        state = "ignored"; // iptal/iade + eşleşmeyen → aksiyon gerekmez
      }
    } else {
      productId = matched.productId;
      stockProductId = matched.productId;
      if (line.category === "sold") {
        if (matched.isBundle && !matched.hasComponents) {
          // Tanımlanmamış paket: bileşeni yok → decrement YOK, kuyruğa düş.
          // appliedDelta = priorDelta (ledger'a dokunma; sayılmışsa bile sapma yaratma).
          state = "setup_pending";
          appliedDelta = priorDelta;
        } else {
          state = "counted";
          appliedDelta = -line.quantity;
        }
      } else if (line.category === "cancelled") {
        state = "reversed";
        appliedDelta = 0;
      } else {
        // returned: OTOMATİK geri ekleme YOK.
        if (priorDelta < 0) {
          state = "return_pending"; // sayılmıştı → düşük kalsın, operatör elle ekler
          appliedDelta = priorDelta;
        } else {
          state = "ignored"; // hiç saymadık → net etki yok
          appliedDelta = 0;
        }
      }
    }

    let adjustDelta = appliedDelta - priorDelta;
    // Hareket yazılacak ama ürün bilinmiyorsa (olmaması gereken durum) güvenli ol.
    if (adjustDelta !== 0 && !stockProductId) {
      adjustDelta = 0;
      appliedDelta = priorDelta;
    }

    if (adjustDelta < 0) unitsDecremented += -adjustDelta;
    else if (adjustDelta > 0) unitsRestored += adjustDelta;

    if (state === "counted") counted += 1;
    else if (state === "reversed") reversed += 1;
    else if (state === "return_pending") returnPending += 1;
    else if (state === "unmatched") unmatched += 1;
    else if (state === "setup_pending") setupPending += 1;
    else ignored += 1;

    plans.push({
      key,
      existingId: prior?.id ?? null,
      orderNumber: line.orderNumber,
      lineId: line.lineId,
      barcode: line.barcode,
      productId,
      quantity: line.quantity,
      channelStatus: line.channelStatus,
      customerName: line.customerName,
      orderDate: line.orderDate,
      raw: line.raw,
      state,
      appliedDelta,
      adjustDelta,
      stockProductId,
    });
  }

  return {
    plans,
    summary: {
      ordersSeen: orders.size,
      linesSeen: plans.length,
      counted,
      reversed,
      returnPending,
      unmatched,
      ignored,
      setupPending,
      unitsDecremented,
      unitsRestored,
    },
  };
}

// TY sipariş yanıtlarını tekil satırlara düzleştirir.
export function flattenOrders(orders: TrendyolOrder[]): IncomingLine[] {
  const out: IncomingLine[] = [];
  for (const o of orders) {
    const orderNumber = o.orderNumber ? String(o.orderNumber) : null;
    if (!orderNumber) continue; // izlenemez
    const pkgStatus = o.shipmentPackageStatus ?? o.status ?? null;
    const customerName =
      [o.customerFirstName, o.customerLastName].filter(Boolean).join(" ").trim() || null;
    const orderDate = typeof o.orderDate === "number" ? o.orderDate : null;
    const lines = o.lines ?? [];
    lines.forEach((l, idx) => {
      const barcode = l.barcode ? String(l.barcode) : null;
      const lineStatus = l.orderLineItemStatusName ?? pkgStatus;
      const rawId = l.id;
      const lineId =
        rawId !== undefined && rawId !== null && String(rawId) !== ""
          ? String(rawId)
          : `${barcode ?? "nobc"}#${idx}`; // TY normalde id döner; bu yalnız savunmacı yedek
      const quantity =
        Number.isFinite(l.quantity) && Number(l.quantity) > 0 ? Math.floor(Number(l.quantity)) : 1;
      out.push({
        orderNumber,
        lineId,
        barcode,
        quantity,
        category: classifyTrendyolStatus(lineStatus),
        channelStatus: lineStatus ?? null,
        customerName,
        orderDate,
        raw: l,
      });
    });
  }
  return out;
}

// Verilen barkodlar için trendyol channel_listings → products eşleme tablosu.
async function loadMatchMap(client: PoolClient, barcodes: string[]): Promise<MatchMap> {
  const map: MatchMap = new Map();
  if (barcodes.length === 0) return map;
  const res = await client.query<{
    external_id: string; product_id: string; name: string;
    is_bundle: boolean; has_components: boolean;
  }>(
    `SELECT cl.external_id, cl.product_id, p.name, p.is_bundle,
            EXISTS (SELECT 1 FROM bundle_components bc WHERE bc.bundle_product_id = p.id) AS has_components
       FROM channel_listings cl
       JOIN products p ON p.id = cl.product_id
      WHERE cl.channel = 'trendyol'
        AND cl.external_id = ANY($1::text[])`,
    [barcodes],
  );
  for (const r of res.rows) {
    map.set(r.external_id, {
      productId: r.product_id,
      internalName: r.name,
      isBundle: r.is_bundle === true,
      hasComponents: r.has_components === true,
    });
  }
  return map;
}

// Verilen order_number'lar için mevcut defter satırları.
async function loadExisting(client: PoolClient, orderNumbers: string[]): Promise<Map<string, ExistingLine>> {
  const map = new Map<string, ExistingLine>();
  if (orderNumbers.length === 0) return map;
  const res = await client.query<{
    id: string; order_number: string; line_id: string; state: LineState;
    applied_delta: number; product_id: string | null;
  }>(
    `SELECT id, order_number, line_id, state, applied_delta, product_id
       FROM channel_order_lines
      WHERE channel = 'trendyol' AND order_number = ANY($1::text[])`,
    [orderNumbers],
  );
  for (const r of res.rows) {
    map.set(lineKey(r.order_number, r.line_id), {
      id: r.id,
      state: r.state,
      appliedDelta: Number(r.applied_delta),
      productId: r.product_id,
    });
  }
  return map;
}

export type OrderSyncDeps = {
  // Test/izolasyon için enjekte edilebilir sipariş çekici. Varsayılan: gerçek client.
  fetchOrders?: (params: GetOrdersParams) => Promise<TrendyolOrdersResponse>;
};

const ORDERS_PAGE_SIZE = 200; // Trendyol orders üst sınırı 200
const MAX_ORDER_PAGES = 50;

// Pencere içindeki tüm sipariş sayfalarını çeker (ağ; transaction DIŞINDA).
async function fetchOrdersWindow(
  fetchOrders: (params: GetOrdersParams) => Promise<TrendyolOrdersResponse>,
  windowDays: number,
): Promise<TrendyolOrder[]> {
  const now = Date.now();
  const startDate = now - windowDays * 86_400_000;
  const out: TrendyolOrder[] = [];
  let page = 0;
  while (page < MAX_ORDER_PAGES) {
    const resp = await fetchOrders({ startDate, endDate: now, page, size: ORDERS_PAGE_SIZE });
    const content = resp.content ?? [];
    out.push(...content);
    const totalPages = resp.totalPages ?? 1;
    page += 1;
    if (page >= totalPages || content.length === 0) break;
  }
  return out;
}

export type OrderSyncResult = ReconcilePlan["summary"] & { applied: boolean };

// Tam senkron akışı: flag kontrol → siparişleri çek (ağ) → transaction'da eşle/planla/
// uygula. PUSH YOK. Flag kapalıysa MarketplaceOrdersDisabledError.
export async function syncTrendyolOrders(deps: OrderSyncDeps = {}): Promise<OrderSyncResult> {
  const settings = await getSettings();
  if (!settings.marketplaceOrdersEnabled) {
    throw new MarketplaceOrdersDisabledError();
  }

  const fetchOrders = deps.fetchOrders ?? defaultGetOrders;

  // 1) Ağ: pencereyi çek (kilit YOK).
  const rawOrders = await fetchOrdersWindow(fetchOrders, env.trendyolOrderWindowDays);
  const incoming = flattenOrders(rawOrders);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // 2) Tek-yazar: global kilit (poller/manuel/çoklu instance seri).
    await withAdvisoryLock(client, ORDER_SYNC_LOCK);

    // 3) Eşleme + mevcut defter (txn içinde, tutarlı snapshot).
    const barcodes = [...new Set(incoming.map(l => l.barcode).filter((b): b is string => !!b))];
    const orderNumbers = [...new Set(incoming.map(l => l.orderNumber))];
    const [matchMap, existing] = await Promise.all([
      loadMatchMap(client, barcodes),
      loadExisting(client, orderNumbers),
    ]);

    // 4) Saf planla.
    const { plans, summary } = planOrderReconciliation(incoming, matchMap, existing);

    // 5) Bundle patlatma + kilit. Hareketli her plan için gerçek stok hedeflerini
    //    hesapla (bundle → bileşenler; basit ürün → kendisi). Kilitler GERÇEK hedef
    //    product_id'lere (bileşenler) göre, POS ile aynı key, ARTAN sırada alınır.
    const planTargets = new Map<string, StockDelta[]>();
    const lockSet = new Set<string>();
    for (const plan of plans) {
      if (plan.adjustDelta !== 0 && plan.stockProductId) {
        const { targets } = await explodeStockDeltas(client, plan.stockProductId, plan.adjustDelta);
        planTargets.set(plan.key, targets);
        for (const t of targets) lockSet.add(t.productId);
      }
    }
    const lockIds = [...lockSet].sort();
    for (const id of lockIds) await withAdvisoryLock(client, stockLockKey(id));

    // 6) Uygula: defteri upsert et, gerekiyorsa stok hareketi yaz.
    for (const plan of plans) {
      let rowId = plan.existingId;
      const orderDateIso = plan.orderDate !== null ? new Date(plan.orderDate).toISOString() : null;
      const rawJson = JSON.stringify(plan.raw ?? null);

      if (rowId === null) {
        const ins = await client.query<{ id: string }>(
          `INSERT INTO channel_order_lines
             (channel, order_number, line_id, barcode, product_id, quantity,
              channel_status, state, applied_delta, customer_name, order_date, raw, last_seen_at)
           VALUES ('trendyol', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
           RETURNING id`,
          [
            plan.orderNumber, plan.lineId, plan.barcode, plan.productId, plan.quantity,
            plan.channelStatus, plan.state, plan.appliedDelta, plan.customerName, orderDateIso, rawJson,
          ],
        );
        rowId = ins.rows[0].id;
      } else {
        // resolved_at/resolved_by KASITEN dokunulmaz (operatörün kuyruk kararı korunur).
        await client.query(
          `UPDATE channel_order_lines
              SET barcode = $2, product_id = $3, quantity = $4, channel_status = $5,
                  state = $6, applied_delta = $7, customer_name = $8, order_date = $9,
                  raw = $10, last_seen_at = now()
            WHERE id = $1`,
          [
            rowId, plan.barcode, plan.productId, plan.quantity, plan.channelStatus,
            plan.state, plan.appliedDelta, plan.customerName, orderDateIso, rawJson,
          ],
        );
      }

      // Bundle ise bileşenlere patlatılmış hareketler; basit ürün ise tek hareket.
      const targets = planTargets.get(plan.key) ?? [];
      for (const t of targets) {
        if (t.delta === 0) continue;
        const type = t.delta < 0 ? "channel_sale" : "channel_cancel";
        await client.query(
          `INSERT INTO stock_movements (product_id, delta, type, related_channel_order_line_id, note)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            t.productId,
            t.delta,
            type,
            rowId,
            `Trendyol ${plan.orderNumber} (${plan.channelStatus ?? "?"})`,
          ],
        );
      }
    }

    await client.query("COMMIT");
    return { ...summary, applied: true };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// ── İnceleme kuyruğu (operatör görünümü) ────────────────────────────────────
export type ReviewItem = {
  id: string;
  orderNumber: string;
  lineId: string;
  barcode: string | null;
  productId: string | null;
  productName: string | null;
  quantity: number;
  channelStatus: string | null;
  state: LineState;
  appliedDelta: number;
  customerName: string | null;
  orderDate: string | null;
  lastSeenAt: string;
};

export type OrderReview = {
  summary: { returnPending: number; unmatched: number; setupPending: number };
  items: ReviewItem[];
};

// Açık inceleme kuyruğu: iade bekleyenler + eşleşmeyen satışlar + kurulum bekleyen
// paketler (tanımlanmamış bundle).
export async function getOrderReviewQueue(): Promise<OrderReview> {
  const res = await pool.query<{
    id: string; order_number: string; line_id: string; barcode: string | null;
    product_id: string | null; product_name: string | null; quantity: number;
    channel_status: string | null; state: LineState; applied_delta: number;
    customer_name: string | null; order_date: string | null; last_seen_at: string;
  }>(
    `SELECT col.id, col.order_number, col.line_id, col.barcode, col.product_id,
            p.name AS product_name, col.quantity, col.channel_status, col.state,
            col.applied_delta, col.customer_name, col.order_date, col.last_seen_at
       FROM channel_order_lines col
       LEFT JOIN products p ON p.id = col.product_id
      WHERE col.channel = 'trendyol'
        AND col.resolved_at IS NULL
        AND col.state IN ('return_pending', 'unmatched', 'setup_pending')
      ORDER BY col.last_seen_at DESC, col.id DESC`,
  );

  let returnPending = 0;
  let unmatched = 0;
  let setupPending = 0;
  const items: ReviewItem[] = res.rows.map(r => {
    if (r.state === "return_pending") returnPending += 1;
    else if (r.state === "unmatched") unmatched += 1;
    else if (r.state === "setup_pending") setupPending += 1;
    return {
      id: r.id,
      orderNumber: r.order_number,
      lineId: r.line_id,
      barcode: r.barcode,
      productId: r.product_id,
      productName: r.product_name,
      quantity: Number(r.quantity),
      channelStatus: r.channel_status,
      state: r.state,
      appliedDelta: Number(r.applied_delta),
      customerName: r.customer_name,
      orderDate: r.order_date,
      lastSeenAt: r.last_seen_at,
    };
  });

  return { summary: { returnPending, unmatched, setupPending }, items };
}

// Operatör bir kuyruk kalemini elle çözüldü işaretler (iadeyi setStock'la ekledikten
// ya da eşleşmeyeni inceledikten sonra). Stoğa DOKUNMAZ — yalnız kuyruktan çıkarır.
export async function resolveOrderReviewItem(
  id: EntityId,
  actorUserId: number | string | null = null,
): Promise<{ id: string }> {
  const res = await pool.query<{ id: string }>(
    `UPDATE channel_order_lines
        SET resolved_at = now(), resolved_by = $2
      WHERE id = $1 AND channel = 'trendyol' AND resolved_at IS NULL
      RETURNING id`,
    [id, actorUserId],
  );
  if (!res.rows[0]) {
    throw new ValidationError("Kuyruk kalemi bulunamadı ya da zaten çözülmüş.");
  }
  return { id: res.rows[0].id };
}
