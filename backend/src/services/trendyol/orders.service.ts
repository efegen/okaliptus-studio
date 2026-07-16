// v1.6 — Trendyol sipariş önizleme (read-only + eşleştirme).
//
// Kapsam: Trendyol'dan GET ile siparişleri çek, her sipariş satırını
// channel_listings (channel='trendyol', external_id = barkod) üzerinden iç ürüne
// EŞLEŞTİR ve ÖNİZLEME döndür. DB'ye sipariş YAZILMAZ; satış/stok'a DOKUNULMAZ.
//
// marketplace_sync_enabled (migration 0242) arkasında: flag kapalıyken önizleme
// ucu MarketplaceSyncDisabledError döner.

import { pool } from "../../db/connection.js";
import { AppError } from "../errors.js";
import { getSettings } from "../settings.service.js";
import {
  getOrders as defaultGetOrders,
  TrendyolApiError,
  type GetOrdersParams,
  type TrendyolOrder,
  type TrendyolOrdersResponse,
} from "./client.js";

export class MarketplaceSyncDisabledError extends AppError {
  constructor(message = "Pazaryeri senkronu kapalı. Ayarlardan 'Kanal eşleştirme'yi açın.") {
    super("MARKETPLACE_SYNC_DISABLED", message, 409);
  }
}

export type PreviewLine = {
  barcode: string | null;
  quantity: number;
  channelProductName: string | null; // Trendyol'dan gelen ad
  matched: boolean;
  productId: string | null;          // eşleşen iç ürün
  internalName: string | null;       // iç ürün adı (channel_listings → products)
};

export type PreviewOrder = {
  orderNumber: string | null;
  status: string | null;
  orderDate: number | null;
  customerName: string | null;
  lines: PreviewLine[];
};

export type OrderPreview = {
  summary: {
    totalOrders: number;
    totalLines: number;
    matchedLines: number;
    unmatchedLines: number;
    unmatchedBarcodes: string[];
  };
  orders: PreviewOrder[];
};

// barcode → { productId, internalName } eşleme tablosu.
export type MatchMap = Map<string, { productId: string; internalName: string }>;

// Saf eşleştirme: Trendyol siparişleri + eşleme tablosu → önizleme. Ağ/DB yok,
// bu yüzden offline test edilebilir.
export function buildOrderPreview(orders: TrendyolOrder[], matchMap: MatchMap): OrderPreview {
  let totalLines = 0;
  let matchedLines = 0;
  const unmatchedBarcodes = new Set<string>();

  const previewOrders: PreviewOrder[] = orders.map(order => {
    const lines = (order.lines ?? []).map((line): PreviewLine => {
      const barcode = line.barcode ? String(line.barcode) : null;
      const quantity = Number.isFinite(line.quantity) ? Number(line.quantity) : 1;
      totalLines += 1;

      const hit = barcode ? matchMap.get(barcode) : undefined;
      if (hit) {
        matchedLines += 1;
      } else if (barcode) {
        unmatchedBarcodes.add(barcode);
      }

      return {
        barcode,
        quantity,
        channelProductName: line.productName ?? null,
        matched: Boolean(hit),
        productId: hit?.productId ?? null,
        internalName: hit?.internalName ?? null,
      };
    });

    const customerName =
      [order.customerFirstName, order.customerLastName].filter(Boolean).join(" ").trim() || null;

    return {
      orderNumber: order.orderNumber ?? null,
      status: order.status ?? null,
      orderDate: typeof order.orderDate === "number" ? order.orderDate : null,
      customerName,
      lines,
    };
  });

  return {
    summary: {
      totalOrders: previewOrders.length,
      totalLines,
      matchedLines,
      unmatchedLines: totalLines - matchedLines,
      unmatchedBarcodes: [...unmatchedBarcodes],
    },
    orders: previewOrders,
  };
}

// Verilen barkodlar için channel_listings (trendyol) → products eşleme tablosu.
async function loadMatchMap(barcodes: string[]): Promise<MatchMap> {
  const map: MatchMap = new Map();
  if (barcodes.length === 0) return map;

  const result = await pool.query<{ external_id: string; product_id: string; name: string }>(
    `SELECT cl.external_id, cl.product_id, p.name
       FROM channel_listings cl
       JOIN products p ON p.id = cl.product_id
      WHERE cl.channel = 'trendyol'
        AND cl.external_id = ANY($1::text[])`,
    [barcodes],
  );
  for (const row of result.rows) {
    map.set(row.external_id, { productId: row.product_id, internalName: row.name });
  }
  return map;
}

export type PreviewDeps = {
  // Test/izolasyon için enjekte edilebilir. Varsayılan: gerçek Trendyol client.
  fetchOrders?: (params: GetOrdersParams) => Promise<TrendyolOrdersResponse>;
};

// Önizleme akışı: flag kontrol → siparişleri çek → barkodları topla → eşleme
// tablosunu yükle → saf eşleştir. Hiçbir kayıt yazmaz.
export async function previewTrendyolOrders(
  params: GetOrdersParams = {},
  deps: PreviewDeps = {},
): Promise<OrderPreview> {
  const settings = await getSettings();
  if (!settings.marketplaceSyncEnabled) {
    throw new MarketplaceSyncDisabledError();
  }

  const fetchOrders = deps.fetchOrders ?? defaultGetOrders;
  const response = await fetchOrders(params);
  const orders = response.content ?? [];

  const barcodes = [
    ...new Set(
      orders
        .flatMap(o => o.lines ?? [])
        .map(l => (l.barcode ? String(l.barcode) : ""))
        .filter(Boolean),
    ),
  ];

  const matchMap = await loadMatchMap(barcodes);
  return buildOrderPreview(orders, matchMap);
}

// ════════════════════════════════════════════════════════════════════════════
// Sipariş GÖRÜNÜMÜ (read-only liste) — Pazaryeri Siparişleri ekranını besler.
//
// previewTrendyolOrders'ın zenginleştirilmiş hâli: TY siparişlerini çekip her satırı
// (a) iç ürüne eşler (channel_listings) ve (b) TY ürün fotoğrafı/başlığıyla
// zenginleştirir (channel_products snapshot). Hiçbir yazma yok; STOK akışına (order-sync
// defteri/poller) DOKUNMAZ — o ayrı `marketplaceOrdersEnabled` flag'inde kalır. Bu uç
// `marketplaceSyncEnabled` (şemsiye/eşleştirme flag'i) ile açılır → siparişleri göstermek
// stoğu değiştirmez (kullanıcının "stok ilk etapta kapalı" kararı).
// ════════════════════════════════════════════════════════════════════════════

export type OrderTab = "yeni" | "isleme" | "tasima" | "teslim" | "yeniden" | "aski" | "diger";

// TY ham paket/satır durumu → ekran sekmesi. Saf (offline test edilebilir).
export function statusToTab(status: string | null | undefined): OrderTab {
  const s = (status ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (s === "awaiting") return "aski";
  // Yeni gelen sipariş = Created VEYA ReadyToShip (TY paketi yeni siparişte
  // shipmentPackageStatus="ReadyToShip" döner; canlı veriyle doğrulandı).
  if (s === "created" || s === "readytoship") return "yeni";
  if (s === "picking" || s === "invoiced") return "isleme";
  if (s === "shipped" || s === "atcollectionpoint") return "tasima";
  if (s === "delivered") return "teslim";
  if (s === "repack" || s === "undelivered") return "yeniden";
  // cancelled / returned / unsupplied / unpacked … → yalnız "Tüm"de görünür.
  return "diger";
}

// Fatura durumu: TY orders yanıtında invoiceLink çoğu zaman GELMEZ → paket durumu
// fatura adımını geçmişse "faturalandı" sayılır (kanıt yoksa "bekleniyor").
function isInvoiced(status: string | null | undefined, invoiceLink?: string): boolean {
  if (invoiceLink) return true;
  const s = (status ?? "").toLowerCase().replace(/[\s_-]/g, "");
  return s === "invoiced" || s === "shipped" || s === "atcollectionpoint" || s === "delivered";
}

export type DisplayLine = {
  lineId: string;
  barcode: string | null;
  quantity: number;
  productName: string | null;
  merchantSku: string | null;
  color: string | null;
  size: string | null;
  unitPrice: number | null;
  matched: boolean;
  internalProductId: string | null;
  internalName: string | null;
  imageUrl: string | null;     // channel_products.image_url (TY fotoğrafı)
  channelTitle: string | null; // channel_products.title
  productUrl: string | null;   // channel_products.product_url (TY ürün sayfası)
};

export type DisplayOrder = {
  id: string;          // orderNumber[::packageId] — UI anahtarı
  channel: "trendyol";
  orderNumber: string;
  packageId: string | null;
  status: string | null;
  tab: OrderTab;
  orderDate: number | null;          // ms
  agreedDeliveryDate: number | null; // ms — "kalan süre"
  lastModifiedDate: number | null;   // ms — son durum değişimi; teslim edilende ≈ teslim zamanı
  buyerName: string | null;
  city: string | null;
  district: string | null;
  cargoProvider: string | null;
  cargoTrackingNumber: string | null;
  cargoTrackingLink: string | null;
  saleAmount: number | null; // grossAmount (Satış Tutarı)
  discount: number | null;   // totalDiscount (Satıcı İndirim)
  billable: number | null;   // totalPrice (Faturalanacak)
  invoiced: boolean;
  lines: DisplayLine[];
};

export type OrdersListResult = {
  orders: DisplayOrder[];
  tabCounts: Record<string, number>; // 'tum' + her sekme
  total: number;
};

// barcode → eşleşen iç ürün / kanal snapshot'ı.
export type DisplayMatchMap = Map<string, { productId: string; internalName: string }>;
export type ChannelInfoMap = Map<string, { imageUrl: string | null; title: string | null; productUrl: string | null }>;

// Saf çekirdek: TY siparişleri + eşleme + kanal-snapshot → görünüm. DB/ağ yok.
export function buildOrdersList(
  orders: TrendyolOrder[],
  matchMap: DisplayMatchMap,
  channelMap: ChannelInfoMap,
): OrdersListResult {
  const out: DisplayOrder[] = [];
  const seen = new Set<string>();
  const tabCounts: Record<string, number> = {
    tum: 0, yeni: 0, isleme: 0, tasima: 0, teslim: 0, yeniden: 0, aski: 0, diger: 0,
  };

  for (const o of orders) {
    const orderNumber = o.orderNumber ? String(o.orderNumber) : null;
    if (!orderNumber) continue;
    const pkgRaw = o.shipmentPackageId ?? o.id;
    const packageId = pkgRaw !== undefined && pkgRaw !== null && String(pkgRaw) !== "" ? String(pkgRaw) : null;
    const id = packageId ? `${orderNumber}::${packageId}` : orderNumber;
    if (seen.has(id)) continue; // ana pencere + Awaiting çağrısı çakışırsa tekrar sayma
    seen.add(id);

    const status = o.shipmentPackageStatus ?? o.status ?? null;
    const tab = statusToTab(status);
    const buyerName =
      [o.customerFirstName, o.customerLastName].filter(Boolean).join(" ").trim() || null;

    const lines = (o.lines ?? []).map((l, idx): DisplayLine => {
      const barcode = l.barcode ? String(l.barcode) : null;
      const m = barcode ? matchMap.get(barcode) : undefined;
      const ch = barcode ? channelMap.get(barcode) : undefined;
      const rawId = l.id;
      const lineId =
        rawId !== undefined && rawId !== null && String(rawId) !== ""
          ? String(rawId)
          : `${barcode ?? "nobc"}#${idx}`;
      return {
        lineId,
        barcode,
        quantity: Number.isFinite(l.quantity) && Number(l.quantity) > 0 ? Math.floor(Number(l.quantity)) : 1,
        productName: l.productName ?? null,
        merchantSku: l.merchantSku ?? l.sku ?? null,
        color: l.productColor ?? null,
        size: l.productSize ?? null,
        unitPrice: typeof l.price === "number" ? l.price : null,
        matched: !!m,
        internalProductId: m?.productId ?? null,
        internalName: m?.internalName ?? null,
        imageUrl: ch?.imageUrl ?? null,
        channelTitle: ch?.title ?? null,
        productUrl: ch?.productUrl ?? null,
      };
    });

    out.push({
      id,
      channel: "trendyol",
      orderNumber,
      packageId,
      status,
      tab,
      orderDate: typeof o.orderDate === "number" ? o.orderDate : null,
      agreedDeliveryDate: typeof o.agreedDeliveryDate === "number" ? o.agreedDeliveryDate : null,
      lastModifiedDate: typeof o.lastModifiedDate === "number" ? o.lastModifiedDate : null,
      buyerName,
      city: o.shipmentAddress?.city ?? null,
      district: o.shipmentAddress?.district ?? null,
      cargoProvider: o.cargoProviderName ?? null,
      cargoTrackingNumber:
        o.cargoTrackingNumber !== undefined && o.cargoTrackingNumber !== null
          ? String(o.cargoTrackingNumber)
          : null,
      cargoTrackingLink: o.cargoTrackingLink ?? null,
      saleAmount: typeof o.grossAmount === "number" ? o.grossAmount : null,
      discount: typeof o.totalDiscount === "number" ? o.totalDiscount : null,
      billable: typeof o.totalPrice === "number" ? o.totalPrice : null,
      invoiced: isInvoiced(status, o.invoiceLink),
      lines,
    });

    tabCounts[tab] = (tabCounts[tab] ?? 0) + 1;
    tabCounts.tum += 1;
  }

  return { orders: out, tabCounts, total: out.length };
}

// barcode'lar için channel_listings (eşleşme) + channel_products (foto/başlık).
async function loadMatchAndChannel(
  barcodes: string[],
): Promise<{ matchMap: DisplayMatchMap; channelMap: ChannelInfoMap }> {
  const matchMap: DisplayMatchMap = new Map();
  const channelMap: ChannelInfoMap = new Map();
  if (barcodes.length === 0) return { matchMap, channelMap };

  const [matchRes, chRes] = await Promise.all([
    pool.query<{ external_id: string; product_id: string; name: string }>(
      `SELECT cl.external_id, cl.product_id, p.name
         FROM channel_listings cl JOIN products p ON p.id = cl.product_id
        WHERE cl.channel = 'trendyol' AND cl.external_id = ANY($1::text[])`,
      [barcodes],
    ),
    pool.query<{ external_id: string; image_url: string | null; title: string | null; product_url: string | null }>(
      `SELECT external_id, image_url, title, product_url FROM channel_products
        WHERE channel = 'trendyol' AND external_id = ANY($1::text[])`,
      [barcodes],
    ),
  ]);
  for (const r of matchRes.rows) matchMap.set(r.external_id, { productId: r.product_id, internalName: r.name });
  for (const r of chRes.rows) channelMap.set(r.external_id, { imageUrl: r.image_url, title: r.title, productUrl: r.product_url });
  return { matchMap, channelMap };
}

export type OrdersListParams = {
  startDate?: number; // ms
  endDate?: number;   // ms
  windowDays?: number;
  includeAwaiting?: boolean; // 'Askıda' sekmesi için status=Awaiting ayrı çekilir
  force?: boolean;           // anlık önbelleği baypas et, canlı bekle ("Yenile")
};

const LIST_PAGE_SIZE = 200; // Trendyol orders üst sınırı
const LIST_MAX_PAGES = 25;
// Trendyol getOrders tek istekte EN FAZLA ~2 hafta aralığını GÜVENİLİR döndürür; daha
// geniş aralık tutarsız/eksik sonuç verir (canlı: 14g=14 sipariş ama 80g=yalnız 10 →
// daha genişte DAHA AZ!). Bu yüzden aralığı 14 günlük pencerelere bölüp ayrı ayrı çeker,
// buildOrdersList (orderNumber::packageId) ile dedup ederiz.
// NOT: TY orders API'si pratikte yalnız son ~3 ayı döndürür (daha eski pencereler boş
// gelir; o siparişler yalnız Trendyol panelinde görünür). MAX_WINDOWS bunu kapsar.
const LIST_CHUNK_DAYS = 14;
const LIST_MAX_WINDOWS = 14;
// Pencereler artık SIRAYLA değil sınırlı eşzamanlılıkla PARALEL çekilir → toplam gecikme
// ~pencere_sayısı kat düşer. 5 eşzamanlı küçük GET tek satıcı için TY'yi zorlamaz
// (rate-limit olursa client retry/backoff yumuşatır).
const LIST_CONCURRENCY = 5;

// ── Anlık (in-memory) snapshot önbelleği — stale-while-revalidate ────────────
// Backend tek, uzun ömürlü Railway süreci (poller de buna dayanır) → modül-düzeyi
// önbellek yeterli; DB'ye HİÇBİR sipariş yazılmaz (salt-okunur sınırı korunur).
// Snapshot pencereye (windowDays / tarih aralığı) göre anahtarlanır; poller varsayılan
// 90 günlük pencereyi ~3 dk'da bir ısıtır → ekran açılışı pratikte ANINDA.
type OrdersSnapshot = { result: OrdersListResult; fetchedAt: number; refreshing: boolean };
const snapshotCache = new Map<string, OrdersSnapshot>();
const SNAPSHOT_STALE_MS = 90_000; // bundan eskiyse arka planda tazele (poller kapalıysa kendini iyileştirir)
const SNAPSHOT_MAX_KEYS = 24;     // sınırsız tarih-aralığı anahtarı birikmesin

function cacheKey(p: OrdersListParams): string {
  if (p.startDate !== undefined || p.endDate !== undefined) {
    return `range:${p.startDate ?? ""}:${p.endDate ?? ""}:${p.includeAwaiting === false ? "0" : "1"}`;
  }
  return `win:${p.windowDays && p.windowDays > 0 ? p.windowDays : 90}`;
}

function storeSnapshot(key: string, result: OrdersListResult): void {
  snapshotCache.set(key, { result, fetchedAt: Date.now(), refreshing: false });
  // Basit kapasite koruması: fazlaysa en eski fetchedAt'li anahtarı at.
  if (snapshotCache.size > SNAPSHOT_MAX_KEYS) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of snapshotCache) {
      if (v.fetchedAt < oldestAt) {
        oldestAt = v.fetchedAt;
        oldestKey = k;
      }
    }
    if (oldestKey && oldestKey !== key) snapshotCache.delete(oldestKey);
  }
}

// "Yeni sipariş" bildirimini (notification-scheduler.ts checkNewChannelOrders)
// besler — stok senkronundan (channel_order_lines, marketplace_orders_enabled)
// BAĞIMSIZ: bu ekran zaten salt-okunur canlı sipariş verisini çekmiş durumda,
// onu ayrıca "gördük" diye damgalıyoruz. Hata sızmaz (bildirim gecikir, ekran etkilenmez).
//
// order_date = Trendyol'un GERÇEK sipariş tarihi (bizim ne zaman gördüğümüz değil).
// checkNewChannelOrders BUNA göre filtreler — first_seen_at'e göre değil — çünkü
// first_seen_at yalnız "defterimiz ilk kez ne zaman doldu"yu yansıtır: geniş/eski
// bir pencere ilk kez çekildiğinde tüm geçmiş siparişler first_seen_at=now() alır
// ve YANLIŞLIKLA "yeni" sayılır (bkz. 0260 migration notu — canlı olayda yaşandı).
async function recordOrderSightings(result: OrdersListResult): Promise<void> {
  if (result.orders.length === 0) return;
  try {
    const params: unknown[] = [];
    const rows: string[] = [];
    let i = 1;
    for (const o of result.orders) {
      params.push("trendyol", o.orderNumber, o.buyerName, o.orderDate !== null ? new Date(o.orderDate) : null);
      rows.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
    }
    await pool.query(
      `INSERT INTO channel_order_sightings (channel, order_number, customer_name, order_date)
       VALUES ${rows.join(", ")}
       ON CONFLICT (channel, order_number) DO NOTHING`,
      params,
    );
  } catch (err) {
    console.error("[trendyol-orders] sipariş görülme kaydı hatası:", err instanceof Error ? err.message : err);
  }
}

async function collectPages(
  fetchOrders: (params: GetOrdersParams) => Promise<TrendyolOrdersResponse>,
  base: GetOrdersParams,
  out: TrendyolOrder[],
): Promise<void> {
  let page = 0;
  while (page < LIST_MAX_PAGES) {
    const resp = await fetchOrders({ ...base, page, size: LIST_PAGE_SIZE });
    const content = resp.content ?? [];
    out.push(...content);
    const totalPages = resp.totalPages ?? 1;
    page += 1;
    if (page >= totalPages || content.length === 0) break;
  }
}

// items'ı en fazla `limit` eşzamanlı çalıştırır; sonuç sırası korunur. Harici bağımlılık yok.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Canlı çekim (önbelleksiz): pencereleri PARALEL çek (kısmi tolerans) → barkodları
// eşle/zenginleştir → saf görünüm. Bir pencere hata verse atlanır; TÜM pencereler
// başarısızsa hata fırlatır (üst katman snapshot'a düşer). Hiçbir kayıt yazmaz.
async function fetchOrdersListLive(
  params: OrdersListParams,
  fetchOrders: (params: GetOrdersParams) => Promise<TrendyolOrdersResponse>,
): Promise<OrdersListResult> {
  const windowDays = params.windowDays && params.windowDays > 0 ? params.windowDays : 90;
  const endDate = params.endDate ?? Date.now();
  const startDate = params.startDate ?? endDate - windowDays * 86_400_000;

  // Aralığı ≤14 günlük pencerelere böl (TY geniş aralığı reddediyor) → en yeniden eskiye.
  const windows: GetOrdersParams[] = [];
  let winEnd = endDate;
  let count = 0;
  while (winEnd > startDate && count < LIST_MAX_WINDOWS) {
    const winStart = Math.max(startDate, winEnd - LIST_CHUNK_DAYS * 86_400_000);
    windows.push({ startDate: winStart, endDate: winEnd });
    winEnd = winStart;
    count += 1;
  }
  // Askıdaki (onay bekleyen) paketler ayrı statüde gelir — güncel durum, tek pencere yeter.
  if (params.includeAwaiting !== false) {
    const awStart = Math.max(startDate, endDate - 14 * 86_400_000);
    windows.push({ status: "Awaiting", startDate: awStart, endDate });
  }

  let failed = 0;
  const perWindow = await mapWithConcurrency(windows, LIST_CONCURRENCY, async (w) => {
    const acc: TrendyolOrder[] = [];
    try {
      await collectPages(fetchOrders, w, acc);
    } catch (err) {
      // Kısmi tolerans: bu pencere atlanır, diğerleri akmaya devam eder.
      failed += 1;
      console.error("[trendyol-orders] pencere alınamadı:", err instanceof Error ? err.message : err);
    }
    return acc;
  });

  // Hiçbir pencere gelmediyse bu gerçek bir başarısızlık (boş yanıt DEĞİL) → fırlat ki
  // üst katman varsa son snapshot'a düşsün, yoksa hatayı göstersin.
  if (windows.length > 0 && failed === windows.length) {
    throw new TrendyolApiError(0, "Trendyol siparişleri alınamadı (tüm pencereler başarısız).");
  }

  const raw = perWindow.flat();
  const barcodes = [
    ...new Set(
      raw.flatMap(o => o.lines ?? []).map(l => (l.barcode ? String(l.barcode) : "")).filter(Boolean),
    ),
  ];
  const { matchMap, channelMap } = await loadMatchAndChannel(barcodes);
  return buildOrdersList(raw, matchMap, channelMap);
}

// Arka plan tazeleme: canlı çekip snapshot'ı günceller. Eşzamanlı tazelemeleri
// `refreshing` bayrağıyla tekilleştirir; hata SIZMAZ (eski snapshot durur). Hem
// stale-okuma yolundan hem poller ısıtmasından çağrılır.
async function revalidateSnapshot(key: string, params: OrdersListParams): Promise<void> {
  const cur = snapshotCache.get(key);
  if (cur?.refreshing) return;
  if (cur) cur.refreshing = true;
  try {
    const fresh = await fetchOrdersListLive(params, defaultGetOrders);
    storeSnapshot(key, fresh);
    void recordOrderSightings(fresh);
  } catch (err) {
    if (cur) cur.refreshing = false; // eski snapshot kalsın (bayat ama veri)
    console.error("[trendyol-orders] snapshot tazeleme hatası:", err instanceof Error ? err.message : err);
  }
}

// Poller çağırır: varsayılan 90 günlük pencerenin snapshot'ını arka planda sıcak tutar
// → kullanıcı ekranı açtığında canlı beklemeden ANINDA görür. Flag kontrolünü
// (marketplaceSyncEnabled) çağıran (poller) yapar.
export async function warmOrdersSnapshot(params: OrdersListParams = { windowDays: 90 }): Promise<void> {
  await revalidateSnapshot(cacheKey(params), params);
}

// Görünüm akışı (önbellekli, stale-while-revalidate):
//   • Test/enjeksiyon (deps.fetchOrders) → önbelleği baypas, saf canlı (deterministik).
//   • Snapshot varsa ANINDA döndür (+ bayatsa arka planda tazele). Poller sayesinde
//     steady-state'te her açılış anında.
//   • force → canlı bekle; başarısızsa snapshot'a düş ("Yenile" tazeyi getirir, TY
//     düşse bile eski veriyi korur).
//   • Hiç snapshot yoksa → canlı çek; başarısızsa hata (ilk açılış + TY tamamen düşük).
// Flag kapalıysa (marketplaceSyncEnabled) HER YOLDAN ÖNCE reddeder. Stoğa dokunmaz.
export async function listTrendyolOrders(
  params: OrdersListParams = {},
  deps: PreviewDeps = {},
): Promise<OrdersListResult> {
  const settings = await getSettings();
  if (!settings.marketplaceSyncEnabled) {
    throw new MarketplaceSyncDisabledError();
  }

  // Enjekte fetcher = smoke/test: önbelleği hiç kullanma (offline, deterministik).
  if (deps.fetchOrders) {
    return fetchOrdersListLive(params, deps.fetchOrders);
  }

  const key = cacheKey(params);
  const cached = snapshotCache.get(key);

  // Taze yol: force değilse ve snapshot varsa anında döndür; bayatsa arka planda tazele.
  if (!params.force && cached) {
    if (Date.now() - cached.fetchedAt > SNAPSHOT_STALE_MS) {
      void revalidateSnapshot(key, params);
    }
    return cached.result;
  }

  // force ya da snapshot yok → canlı çek.
  try {
    const fresh = await fetchOrdersListLive(params, defaultGetOrders);
    storeSnapshot(key, fresh);
    void recordOrderSightings(fresh);
    return fresh;
  } catch (err) {
    // force tazeleme başarısız ama elde eski snapshot varsa onu göster (hata yerine veri).
    if (cached) return cached.result;
    throw err;
  }
}
