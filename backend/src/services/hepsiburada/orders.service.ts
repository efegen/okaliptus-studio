// Hepsiburada sipariş GÖRÜNÜMÜ (salt-okuma) — Siparişler ekranını Trendyol'la
// AYNI biçimde (DisplayOrder, aynı sekmeler) besler. HB'ye hiçbir şey yazmaz,
// stoğa dokunmaz. Trendyol görünümüyle aynı flag'in (marketplaceSyncEnabled)
// arkasındadır.
//
// HB'de tek bir "tüm siparişler" ucu yok; paketler durumlarına göre ayrı uçlarda:
//   • GET /packages              → kargoya hazır (paketlenmiş) — TAM veri    → "yeni"
//   • GET /packages/shipped      → kargoya verilen   — İNCE kayıt            → "tasima"
//   • GET /packages/delivered    → teslim edilen     — İNCE kayıt            → "teslim"
//   • GET /packages/undelivered  → teslim edilemeyen — İNCE kayıt            → "yeniden"
//   • GET /orders                → ödemesi alınmış, henüz paketlenmemiş      → "yeni"
//   • GET /orders/cancelled      → iptal edilen kalemler                     → "diger"
// İnce kayıtlar (paket no + barkod + tarih) sipariş detayıyla (GET /orders/.../
// ordernumber/{n}) ürün, müşteri ve tutarla tamamlanır; kargo takip linki paketin
// kargo bilgisinden (GET /packages/.../packagenumber/{n}) gelir. Detay ve kargo
// bilgisi süreç içinde önbelleklenir: teslim edilmiş paket değişmez (24 sa),
// diğerleri kısa süre (2,5 dk) tutulur.
//
// Sekme, paketin GELDİĞİ LİSTEDEN türetilir (detaydaki ham durum yalnız gösterim
// içindir). Aynı paket birden çok listede görünürse: teslim edilen her zaman
// kazanır; kargoda / teslim edilemedi arasında olay tarihi yeni olan; paketlenmiş
// (kargoya hazır) en zayıftır.
//
// Barkod: Trendyol'daki gibi istemci, cargoTrackingNumber'dan Code128 çizer. HB'de
// bu alana paketin kargo BARKODU (etikette basılan, ör. "6245…") konur; kargo
// firmasının kendi takip no'su (ör. PTT "KP…") yalnız takip linkinde kullanılır.

import { pool } from "../../db/connection.js";
import { getSettings } from "../settings.service.js";
import {
  MarketplaceSyncDisabledError,
  countTabs,
  type DisplayLine,
  type DisplayOrder,
  type OrderTab,
  type OrdersListResult,
} from "../trendyol/orders.service.js";
import {
  HepsiburadaApiError,
  getCancelledOrders,
  getOrderDetail,
  getPackageCargoInfo,
  getPackageEvents,
  getPackages,
  getPaidOrders,
  isHepsiburadaConfigured,
  type HepsiburadaMoney,
  type HepsiburadaOrderDetail,
  type HepsiburadaOrderItem,
  type HepsiburadaPackage,
  type HepsiburadaPackageCargoInfo,
  type HepsiburadaPackageEvent,
  type HepsiburadaPackageEventKind,
  type HepsiburadaProperty,
} from "./client.js";

export type HbOrdersListResult = OrdersListResult & {
  // false → HB kimliği yok; liste boş döner (ekran Trendyol'la çalışmaya devam eder).
  configured: boolean;
};

// ── Saf yardımcılar ──────────────────────────────────────────────────────────

// HB tarihleri saat dilimsiz İstanbul saatidir ("2026-11-14T10:11:59"); "0001-…"
// boş değer demektir.
export function hbDate(raw: string | null | undefined): number | null {
  if (!raw || raw.startsWith("0001-")) return null;
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/i.test(raw);
  const ms = Date.parse(hasZone ? raw : `${raw}+03:00`);
  return Number.isFinite(ms) ? ms : null;
}

function money(m: HepsiburadaMoney | number | null | undefined): number | null {
  if (typeof m === "number") return Number.isFinite(m) ? m : null;
  return m && typeof m.amount === "number" && Number.isFinite(m.amount) ? m.amount : null;
}

function sumOrNull(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

function prop(props: HepsiburadaProperty[] | null | undefined, names: string[]): string | null {
  const hit = (props ?? []).find(p => p?.name && names.includes(p.name.toLocaleLowerCase("tr-TR")));
  return hit?.value ? String(hit.value) : null;
}

const IMAGE_SIZE = "500";
function imageUrl(format: string | null | undefined): string | null {
  if (!format || !/^https:\/\//i.test(format)) return null;
  return format.replace("{size}", IMAGE_SIZE);
}

const str = (v: unknown): string | null => (v === undefined || v === null || String(v) === "" ? null : String(v));

// merchantSku → iç ürün (channel_listings, channel='hepsiburada'; HB anahtarı merchantSku).
export type HbMatchMap = Map<string, { productId: string; internalName: string }>;

type RawLine = {
  id?: string | null;
  merchantSku?: string | null;
  productBarcode?: string | null;
  name?: string | null;
  quantity?: number | null;
  unitPrice?: HepsiburadaMoney | number | null;
  totalPrice?: HepsiburadaMoney | number | null;
  merchantDiscount?: HepsiburadaMoney | number | null;
  commissionRate?: number | null;
  vatRate?: number | null;
  productImageUrlFormat?: string | null;
  properties?: HepsiburadaProperty[] | null;
};

type LineWithMoney = DisplayLine & { lineTotal: number | null; lineDiscount: number | null };

function toLine(raw: RawLine, idx: number, matchMap: HbMatchMap): LineWithMoney {
  const merchantSku = str(raw.merchantSku);
  const m = merchantSku ? matchMap.get(merchantSku) : undefined;
  const quantity = Number.isFinite(raw.quantity) && Number(raw.quantity) > 0 ? Math.floor(Number(raw.quantity)) : 1;
  const unitPrice = money(raw.unitPrice);
  const lineTotal = money(raw.totalPrice) ?? (unitPrice !== null ? unitPrice * quantity : null);
  return {
    lineId: str(raw.id) ?? `${merchantSku ?? "nosku"}#${idx}`,
    barcode: str(raw.productBarcode),
    quantity,
    productName: str(raw.name),
    merchantSku,
    color: prop(raw.properties, ["renk", "color"]),
    size: prop(raw.properties, ["beden", "boyut", "ebat", "size"]),
    unitPrice,
    commissionRate: typeof raw.commissionRate === "number" && Number.isFinite(raw.commissionRate) ? raw.commissionRate : null,
    vatRate: typeof raw.vatRate === "number" && Number.isFinite(raw.vatRate) ? raw.vatRate : null,
    matched: !!m,
    internalProductId: m?.productId ?? null,
    internalName: m?.internalName ?? null,
    imageUrl: imageUrl(raw.productImageUrlFormat),
    channelTitle: str(raw.name),
    productUrl: null,
    lineTotal,
    lineDiscount: money(raw.merchantDiscount),
  };
}

// Satır tutarları → sipariş tutarları. Faturalanacak = satır toplamları; satıcı
// indirimi ayrı gelir; satış tutarı = ikisinin toplamı (indirim öncesi).
function totals(lines: LineWithMoney[]): Pick<DisplayOrder, "saleAmount" | "discount" | "billable"> {
  const billable = sumOrNull(lines.map(l => l.lineTotal));
  const discount = sumOrNull(lines.map(l => l.lineDiscount));
  const saleAmount = billable === null ? null : sumOrNull([billable, discount]);
  return { saleAmount, discount, billable };
}

function stripMoney(lines: LineWithMoney[]): DisplayLine[] {
  return lines.map(({ lineTotal: _t, lineDiscount: _d, ...rest }) => rest);
}

const EVENT_TAB: Record<HepsiburadaPackageEventKind, OrderTab> = {
  shipped: "tasima",
  delivered: "teslim",
  undelivered: "yeniden",
};

const TAB_STATUS: Record<OrderTab, string> = {
  yeni: "Packaged",
  isleme: "Packaged",
  tasima: "InTransit",
  teslim: "Delivered",
  yeniden: "Undelivered",
  aski: "Awaiting",
  diger: "Cancelled",
};

type PackageEntry = {
  packageNumber: string;
  orderNumber: string;
  tab: OrderTab;
  barcode: string | null;
  eventMs: number | null;
  hasInvoice: boolean | null;
  packed: HepsiburadaPackage | null; // yalnız GET /packages'tan gelende (tam veri)
};

// Aynı paket iki listede görünürse hangisi geçerli? (bkz. dosya başı)
function preferEntry(a: PackageEntry, b: PackageEntry): PackageEntry {
  if (a.tab === "teslim") return a;
  if (b.tab === "teslim") return b;
  if (a.packed && !b.packed) return b;
  if (b.packed && !a.packed) return a;
  return (b.eventMs ?? 0) > (a.eventMs ?? 0) ? b : a;
}

export type HbRawOrders = {
  packed: HepsiburadaPackage[];
  events: Record<HepsiburadaPackageEventKind, HepsiburadaPackageEvent[]>;
  paid: HepsiburadaOrderItem[];
  cancelled: HepsiburadaOrderItem[];
};

export type HbEnrichment = {
  details: Map<string, HepsiburadaOrderDetail>;       // orderNumber → detay
  cargo: Map<string, HepsiburadaPackageCargoInfo>;    // packageNumber → kargo bilgisi
  matchMap: HbMatchMap;
};

// Paketleri tekilleştirip geçerli kaydı seçer (saf).
export function collectPackages(raw: HbRawOrders): PackageEntry[] {
  const byPackage = new Map<string, PackageEntry>();
  const put = (e: PackageEntry) => {
    const cur = byPackage.get(e.packageNumber);
    byPackage.set(e.packageNumber, cur ? preferEntry(cur, e) : e);
  };
  for (const p of raw.packed) {
    const packageNumber = str(p.packageNumber);
    const orderNumber = str(p.items?.find(i => i.orderNumber)?.orderNumber);
    if (!packageNumber || !orderNumber) continue;
    put({ packageNumber, orderNumber, tab: "yeni", barcode: str(p.barcode), eventMs: null, hasInvoice: null, packed: p });
  }
  for (const kind of Object.keys(EVENT_TAB) as HepsiburadaPackageEventKind[]) {
    for (const e of raw.events[kind] ?? []) {
      const packageNumber = str(e.PackageNumber);
      const orderNumber = str(e.OrderNumber) ?? str(e.OrderNumbers?.[0]);
      if (!packageNumber || !orderNumber) continue;
      const eventMs = hbDate(kind === "shipped" ? e.ShippedDate : kind === "delivered" ? e.DeliveredDate : e.UndeliveredDate);
      put({
        packageNumber,
        orderNumber,
        tab: EVENT_TAB[kind],
        barcode: str(e.Barcode),
        eventMs,
        hasInvoice: typeof e.HasInvoice === "boolean" ? e.HasInvoice : null,
        packed: null,
      });
    }
  }
  return [...byPackage.values()];
}

function fromPacked(entry: PackageEntry, p: HepsiburadaPackage, enrich: HbEnrichment): DisplayOrder {
  const lines = (p.items ?? []).map((i, idx) =>
    toLine(
      {
        id: i.lineItemId ?? i.orderLineId,
        merchantSku: i.merchantSku,
        productBarcode: i.productBarcode,
        name: i.productName ?? i.name,
        quantity: i.quantity,
        unitPrice: i.price,
        totalPrice: i.totalPrice,
        merchantDiscount: i.totalMerchantDiscount,
        commissionRate: i.commissionRate,
        vatRate: i.vatRate,
        productImageUrlFormat: i.productImageUrlFormat,
        properties: i.properties,
      },
      idx,
      enrich.matchMap,
    ),
  );
  const cargo = enrich.cargo.get(entry.packageNumber);
  const orderDates = (p.items ?? []).map(i => hbDate(i.orderDate)).filter((v): v is number => v !== null);
  return {
    id: `hb:${entry.orderNumber}::${entry.packageNumber}`,
    channel: "hepsiburada",
    orderNumber: entry.orderNumber,
    packageId: entry.packageNumber,
    status: str(p.status) ?? TAB_STATUS.yeni,
    tab: entry.tab,
    orderDate: orderDates.length ? Math.min(...orderDates) : hbDate(p.orderDate),
    agreedDeliveryDate: hbDate(p.dueDate),
    lastModifiedDate: null,
    buyerName: str(p.recipientName) ?? str(p.customerName),
    city: str(p.shippingCity),
    district: str(p.shippingTown) ?? str(p.shippingDistrict),
    cargoProvider: str(cargo?.cargoCompany) ?? str(p.cargoCompany),
    cargoTrackingNumber: entry.barcode,
    cargoTrackingLink: str(cargo?.trackingInfoUrl),
    ...totals(lines),
    invoiced: false,
    lines: stripMoney(lines),
  };
}

function fromEvent(entry: PackageEntry, enrich: HbEnrichment): DisplayOrder {
  const detail = enrich.details.get(entry.orderNumber);
  const all = detail?.items ?? [];
  const mine = all.filter(i => str(i.packageNumber) === entry.packageNumber);
  const items = mine.length ? mine : all; // detay paket no taşımıyorsa siparişin tüm kalemleri
  const first = items[0];
  const lines = items.map((i, idx) =>
    toLine(
      {
        id: i.id,
        merchantSku: i.merchantSKU,
        productBarcode: i.productBarcode,
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        totalPrice: i.totalPrice,
        merchantDiscount: i.merchantDiscount?.totalPrice,
        commissionRate: i.commissionRate,
        vatRate: i.vatRate,
        productImageUrlFormat: i.productImageUrlFormat,
        properties: i.properties,
      },
      idx,
      enrich.matchMap,
    ),
  );
  const cargo = enrich.cargo.get(entry.packageNumber);
  const address = detail?.deliveryAddress ?? first?.shippingAddress;
  return {
    id: `hb:${entry.orderNumber}::${entry.packageNumber}`,
    channel: "hepsiburada",
    orderNumber: entry.orderNumber,
    packageId: entry.packageNumber,
    status: str(first?.status) ?? TAB_STATUS[entry.tab],
    tab: entry.tab,
    orderDate: hbDate(detail?.orderDate) ?? hbDate(first?.orderDate),
    agreedDeliveryDate: hbDate(first?.dueDate),
    lastModifiedDate: entry.eventMs ?? hbDate(first?.lastStatusUpdateDate),
    buyerName: str(detail?.customer?.name) ?? str(address?.name) ?? str(first?.customerName),
    city: str(address?.city),
    district: str(address?.town) ?? str(address?.district),
    cargoProvider: str(cargo?.cargoCompany) ?? str(first?.cargoCompany),
    cargoTrackingNumber: entry.barcode ?? str(first?.barcode),
    cargoTrackingLink: str(cargo?.trackingInfoUrl),
    ...totals(lines),
    invoiced: entry.hasInvoice ?? items.some(i => i.hasInvoice === true),
    // İade talebi açık (ör. "ClaimCreated"). Sekme DEĞİŞMEZ (Trendyol'da da talep
    // açıkken sipariş Teslim'de kalır); ekran yalnız not gösterir.
    returnRequested: items.some(i => /^claim/i.test(i.status ?? "")),
    lines: stripMoney(lines),
  };
}

// Paketlenmemiş (ödemesi alınmış) ya da iptal kalemlerini siparişe göre gruplar.
function fromOrderItems(
  items: HepsiburadaOrderItem[],
  tab: OrderTab,
  skip: Set<string>,
  enrich: HbEnrichment,
): DisplayOrder[] {
  const byOrder = new Map<string, HepsiburadaOrderItem[]>();
  for (const i of items) {
    const orderNumber = str(i.orderNumber);
    if (!orderNumber || skip.has(orderNumber)) continue;
    byOrder.set(orderNumber, [...(byOrder.get(orderNumber) ?? []), i]);
  }
  return [...byOrder].map(([orderNumber, group]) => {
    const lines = group.map((i, idx) =>
      toLine(
        { id: i.id, merchantSku: i.merchantSku, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, totalPrice: i.totalPrice },
        idx,
        enrich.matchMap,
      ),
    );
    const first = group[0];
    return {
      id: `hb:${orderNumber}`,
      channel: "hepsiburada" as const,
      orderNumber,
      packageId: null,
      status: str(first.status) ?? TAB_STATUS[tab],
      tab,
      orderDate: hbDate(first.orderDate),
      agreedDeliveryDate: null,
      lastModifiedDate: null,
      buyerName: str(first.customerName),
      city: null,
      district: null,
      cargoProvider: str(first.cargoCompany),
      cargoTrackingNumber: null,
      cargoTrackingLink: null,
      ...totals(lines),
      invoiced: false,
      lines: stripMoney(lines),
    };
  });
}

// Saf çekirdek: ham HB listeleri + zenginleştirme → ekran görünümü. Ağ/DB yok.
// windowStartMs verilirse iptaller sipariş tarihine göre süzülür (iptal ucu tarih almaz).
export function buildHepsiburadaOrders(
  raw: HbRawOrders,
  enrich: HbEnrichment,
  opts: { windowStartMs?: number; windowEndMs?: number } = {},
): OrdersListResult {
  const entries = collectPackages(raw);
  const orders: DisplayOrder[] = entries.map(e => (e.packed ? fromPacked(e, e.packed, enrich) : fromEvent(e, enrich)));
  const packagedOrders = new Set(entries.map(e => e.orderNumber));
  orders.push(...fromOrderItems(raw.paid, "yeni", packagedOrders, enrich));
  const cancelled = fromOrderItems(raw.cancelled, "diger", packagedOrders, enrich).filter(o => {
    if (o.orderDate === null) return true;
    if (opts.windowStartMs !== undefined && o.orderDate < opts.windowStartMs) return false;
    if (opts.windowEndMs !== undefined && o.orderDate > opts.windowEndMs) return false;
    return true;
  });
  orders.push(...cancelled);
  orders.sort((a, b) => (b.orderDate ?? 0) - (a.orderDate ?? 0));
  return { orders, tabCounts: countTabs(orders), total: orders.length };
}

// Ham listelerden, detayı/kargo bilgisi gereken sipariş ve paket numaraları.
export function enrichmentNeeds(raw: HbRawOrders): {
  orderNumbers: Array<{ orderNumber: string; final: boolean }>;
  packageNumbers: Array<{ packageNumber: string; final: boolean }>;
} {
  const entries = collectPackages(raw);
  const orders = new Map<string, boolean>();
  const packages: Array<{ packageNumber: string; final: boolean }> = [];
  for (const e of entries) {
    if (e.packed) continue; // tam veri zaten var; kargo bilgisi de gerekmez (henüz kargoda değil)
    const final = e.tab === "teslim";
    orders.set(e.orderNumber, (orders.get(e.orderNumber) ?? true) && final);
    packages.push({ packageNumber: e.packageNumber, final });
  }
  return { orderNumbers: [...orders].map(([orderNumber, final]) => ({ orderNumber, final })), packageNumbers: packages };
}

// ── Kaynak (ağ) — test için enjekte edilebilir ───────────────────────────────

export type HbOrderSource = {
  packedPackages(): Promise<HepsiburadaPackage[]>;
  packageEvents(kind: HepsiburadaPackageEventKind, beginMs: number, endMs: number): Promise<HepsiburadaPackageEvent[]>;
  paidOrders(): Promise<HepsiburadaOrderItem[]>;
  cancelledOrders(): Promise<HepsiburadaOrderItem[]>;
  orderDetail(orderNumber: string): Promise<HepsiburadaOrderDetail | null>;
  cargoInfo(packageNumber: string): Promise<HepsiburadaPackageCargoInfo | null>;
};

const PACKED_PAGE = 10;   // HB belgesi: /packages limit en fazla 10
const PACKED_MAX_PAGES = 50;
const EVENT_PAGE = 50;
const EVENT_MAX_PAGES = 40;
const ORDERS_PAGE = 50;
const ORDERS_MAX_PAGES = 20;

async function pagedItems<T>(
  fetchPage: (offset: number) => Promise<{ items?: T[]; totalCount?: number }>,
  pageSize: number,
  maxPages: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const data = await fetchPage(out.length);
    const items = data.items ?? [];
    out.push(...items);
    const total = typeof data.totalCount === "number" ? data.totalCount : null;
    if (items.length < pageSize || (total !== null && out.length >= total)) break;
  }
  return out;
}

export const defaultHbOrderSource: HbOrderSource = {
  async packedPackages() {
    const seen = new Map<string, HepsiburadaPackage>();
    for (let page = 0; page < PACKED_MAX_PAGES; page += 1) {
      const res = await getPackages({ offset: page * PACKED_PAGE, limit: PACKED_PAGE });
      const rows = Array.isArray(res.data) ? res.data : [];
      let added = 0;
      for (const p of rows) {
        const key = str(p.packageNumber) ?? str(p.id);
        if (key && !seen.has(key)) {
          seen.set(key, p);
          added += 1;
        }
      }
      // Kısa sayfa = son sayfa. HB Offset'i yok sayarsa aynı sayfa döner → yeni kayıt yoksa dur.
      if (rows.length < PACKED_PAGE || added === 0) break;
    }
    return [...seen.values()];
  },
  async packageEvents(kind, beginMs, endMs) {
    return pagedItems(
      async offset => (await getPackageEvents(kind, { beginMs, endMs, offset, limit: EVENT_PAGE })).data ?? {},
      EVENT_PAGE,
      EVENT_MAX_PAGES,
    );
  },
  async paidOrders() {
    return pagedItems(async offset => (await getPaidOrders({ offset, limit: ORDERS_PAGE })).data ?? {}, ORDERS_PAGE, ORDERS_MAX_PAGES);
  },
  async cancelledOrders() {
    return pagedItems(async offset => (await getCancelledOrders({ offset, limit: ORDERS_PAGE })).data ?? {}, ORDERS_PAGE, ORDERS_MAX_PAGES);
  },
  async orderDetail(orderNumber) {
    return (await getOrderDetail(orderNumber)).data ?? null;
  },
  async cargoInfo(packageNumber) {
    const rows = (await getPackageCargoInfo(packageNumber)).data;
    return (Array.isArray(rows) ? rows.find(r => str(r.packageNumber) === packageNumber) ?? rows[0] : null) ?? null;
  },
};

// ── Detay / kargo bilgisi önbelleği ──────────────────────────────────────────
// Teslim edilmiş paketin detayı değişmez → uzun; diğerleri (kargo firması, durum
// değişebilir) kısa. Liste ısıtması ~3 dk'da bir olduğundan kısa TTL bundan az.
const FINAL_TTL_MS = 24 * 3_600_000;
const LIVE_TTL_MS = 150_000;
const CACHE_MAX_AGE_MS = 48 * 3_600_000;
const ENRICH_CONCURRENCY = 4;

type Cached<T> = { value: T; fetchedAt: number };
const detailCache = new Map<string, Cached<HepsiburadaOrderDetail>>();
const cargoCache = new Map<string, Cached<HepsiburadaPackageCargoInfo>>();

function pruneCache<T>(cache: Map<string, Cached<T>>, now: number): void {
  for (const [k, v] of cache) if (now - v.fetchedAt > CACHE_MAX_AGE_MS) cache.delete(k);
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

// Önbellekli değeri döndürür; yoksa/bayatsa çeker. Hata SIZMAZ: eski değer (varsa) kullanılır.
async function cachedFetch<T>(
  cache: Map<string, Cached<T>>,
  key: string,
  final: boolean,
  fetch: () => Promise<T | null>,
  useCache: boolean,
): Promise<T | null> {
  const now = Date.now();
  const hit = useCache ? cache.get(key) : undefined;
  if (hit && now - hit.fetchedAt < (final ? FINAL_TTL_MS : LIVE_TTL_MS)) return hit.value;
  try {
    const value = await fetch();
    if (value && useCache) cache.set(key, { value, fetchedAt: now });
    return value ?? hit?.value ?? null;
  } catch (err) {
    console.error(`[hb-orders] ${key} alınamadı:`, err instanceof Error ? err.message : err);
    return hit?.value ?? null;
  }
}

async function loadMatchMap(skus: string[]): Promise<HbMatchMap> {
  const map: HbMatchMap = new Map();
  if (skus.length === 0) return map;
  const res = await pool.query<{ external_id: string; product_id: string; name: string }>(
    `SELECT cl.external_id, cl.product_id, p.name
       FROM channel_listings cl JOIN products p ON p.id = cl.product_id
      WHERE cl.channel = 'hepsiburada' AND cl.external_id = ANY($1::text[])`,
    [skus],
  );
  for (const r of res.rows) map.set(r.external_id, { productId: r.product_id, internalName: r.name });
  return map;
}

function allMerchantSkus(raw: HbRawOrders, details: Map<string, HepsiburadaOrderDetail>): string[] {
  const skus = new Set<string>();
  const add = (v: unknown) => {
    const s = str(v);
    if (s) skus.add(s);
  };
  for (const p of raw.packed) for (const i of p.items ?? []) add(i.merchantSku);
  for (const d of details.values()) for (const i of d.items ?? []) add(i.merchantSKU);
  for (const i of [...raw.paid, ...raw.cancelled]) add(i.merchantSku);
  return [...skus];
}

export type HbListParams = {
  startDate?: number; // ms
  endDate?: number;   // ms
  windowDays?: number;
  force?: boolean;
};

// Canlı çekim: listeleri paralel al (kısmi tolerans) → detay/kargo ile tamamla →
// iç ürün eşleşmesi → saf görünüm. Hiçbir liste gelmezse hata fırlatır.
async function fetchLive(params: HbListParams, source: HbOrderSource, useCache: boolean): Promise<OrdersListResult> {
  const windowDays = params.windowDays && params.windowDays > 0 ? params.windowDays : 90;
  const endMs = params.endDate ?? Date.now();
  const beginMs = params.startDate ?? endMs - windowDays * 86_400_000;

  let failed = 0;
  const soft = async <T>(label: string, work: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await work();
    } catch (err) {
      failed += 1;
      console.error(`[hb-orders] ${label} alınamadı:`, err instanceof Error ? err.message : err);
      return [];
    }
  };
  const [packed, shipped, delivered, undelivered, paid, cancelled] = await Promise.all([
    soft("kargoya hazır paketler", () => source.packedPackages()),
    soft("kargodaki paketler", () => source.packageEvents("shipped", beginMs, endMs)),
    soft("teslim edilen paketler", () => source.packageEvents("delivered", beginMs, endMs)),
    soft("teslim edilemeyen paketler", () => source.packageEvents("undelivered", beginMs, endMs)),
    soft("paketlenmemiş siparişler", () => source.paidOrders()),
    soft("iptal edilen siparişler", () => source.cancelledOrders()),
  ]);
  if (failed === 6) throw new HepsiburadaApiError(0, "Hepsiburada siparişleri alınamadı (tüm listeler başarısız).");

  const raw: HbRawOrders = { packed, events: { shipped, delivered, undelivered }, paid, cancelled };
  const needs = enrichmentNeeds(raw);
  const details = new Map<string, HepsiburadaOrderDetail>();
  const cargo = new Map<string, HepsiburadaPackageCargoInfo>();
  await Promise.all([
    mapWithConcurrency(needs.orderNumbers, ENRICH_CONCURRENCY, async ({ orderNumber, final }) => {
      const d = await cachedFetch(detailCache, orderNumber, final, () => source.orderDetail(orderNumber), useCache);
      if (d) details.set(orderNumber, d);
    }),
    mapWithConcurrency(needs.packageNumbers, ENRICH_CONCURRENCY, async ({ packageNumber, final }) => {
      const c = await cachedFetch(cargoCache, packageNumber, final, () => source.cargoInfo(packageNumber), useCache);
      if (c) cargo.set(packageNumber, c);
    }),
  ]);
  if (useCache) {
    const now = Date.now();
    pruneCache(detailCache, now);
    pruneCache(cargoCache, now);
  }

  const matchMap = await loadMatchMap(allMerchantSkus(raw, details));
  return buildHepsiburadaOrders(raw, { details, cargo, matchMap }, { windowStartMs: beginMs, windowEndMs: endMs });
}

// ── Liste snapshot'ı (stale-while-revalidate) — Trendyol görünümüyle aynı model ─
type Snapshot = { result: OrdersListResult; fetchedAt: number; refreshing: boolean };
const snapshots = new Map<string, Snapshot>();
const SNAPSHOT_STALE_MS = 90_000;
const SNAPSHOT_MAX_KEYS = 24;

function cacheKey(p: HbListParams): string {
  if (p.startDate !== undefined || p.endDate !== undefined) return `range:${p.startDate ?? ""}:${p.endDate ?? ""}`;
  return `win:${p.windowDays && p.windowDays > 0 ? p.windowDays : 90}`;
}

function storeSnapshot(key: string, result: OrdersListResult): void {
  snapshots.set(key, { result, fetchedAt: Date.now(), refreshing: false });
  if (snapshots.size > SNAPSHOT_MAX_KEYS) {
    let oldest: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of snapshots) {
      if (v.fetchedAt < oldestAt) {
        oldestAt = v.fetchedAt;
        oldest = k;
      }
    }
    if (oldest && oldest !== key) snapshots.delete(oldest);
  }
}

// "Yeni sipariş" bildirimini besler (notification-scheduler checkNewChannelOrders).
// order_date = HB'nin GERÇEK sipariş tarihi. Hata sızmaz.
async function recordOrderSightings(result: OrdersListResult): Promise<void> {
  const rows = result.orders.filter(o => o.orderDate !== null);
  if (rows.length === 0) return;
  try {
    const seen = new Set<string>();
    const params: unknown[] = [];
    const values: string[] = [];
    let i = 1;
    for (const o of rows) {
      if (seen.has(o.orderNumber)) continue; // bir sipariş birden çok paket olabilir
      seen.add(o.orderNumber);
      params.push("hepsiburada", o.orderNumber, o.buyerName, new Date(o.orderDate as number));
      values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
    }
    await pool.query(
      `INSERT INTO channel_order_sightings (channel, order_number, customer_name, order_date)
       VALUES ${values.join(", ")}
       ON CONFLICT (channel, order_number) DO NOTHING`,
      params,
    );
  } catch (err) {
    console.error("[hb-orders] sipariş görülme kaydı hatası:", err instanceof Error ? err.message : err);
  }
}

async function revalidate(key: string, params: HbListParams): Promise<void> {
  const cur = snapshots.get(key);
  if (cur?.refreshing) return;
  if (cur) cur.refreshing = true;
  try {
    const fresh = await fetchLive(params, defaultHbOrderSource, true);
    storeSnapshot(key, fresh);
    void recordOrderSightings(fresh);
  } catch (err) {
    if (cur) cur.refreshing = false;
    console.error("[hb-orders] snapshot tazeleme hatası:", err instanceof Error ? err.message : err);
  }
}

// Poller çağırır: varsayılan 90 günlük pencereyi sıcak tutar. Flag kontrolü çağıranda.
export async function warmHepsiburadaOrders(params: HbListParams = { windowDays: 90 }): Promise<void> {
  await revalidate(cacheKey(params), params);
}

function emptyResult(): HbOrdersListResult {
  return { orders: [], tabCounts: countTabs([]), total: 0, configured: false };
}

export type HbListDeps = { source?: HbOrderSource };

// Görünüm akışı (Trendyol'la aynı): snapshot varsa anında döner (bayatsa arka planda
// tazeler); force → canlı bekler, başarısızsa snapshot'a düşer; snapshot yoksa canlı.
// Enjekte kaynak (smoke) → önbelleksiz, deterministik. HB kimliği yoksa boş liste.
export async function listHepsiburadaOrders(params: HbListParams = {}, deps: HbListDeps = {}): Promise<HbOrdersListResult> {
  const settings = await getSettings();
  if (!settings.marketplaceSyncEnabled) throw new MarketplaceSyncDisabledError();

  if (deps.source) {
    const result = await fetchLive(params, deps.source, false);
    await recordOrderSightings(result); // test yolu: kayıt bitmeden dönme (deterministik)
    return { ...result, configured: true };
  }
  if (!isHepsiburadaConfigured()) return emptyResult();

  const key = cacheKey(params);
  const cached = snapshots.get(key);
  if (!params.force && cached) {
    if (Date.now() - cached.fetchedAt > SNAPSHOT_STALE_MS) void revalidate(key, params);
    return { ...cached.result, configured: true };
  }
  try {
    const fresh = await fetchLive(params, defaultHbOrderSource, true);
    storeSnapshot(key, fresh);
    void recordOrderSightings(fresh);
    return { ...fresh, configured: true };
  } catch (err) {
    if (cached) return { ...cached.result, configured: true };
    throw err;
  }
}
