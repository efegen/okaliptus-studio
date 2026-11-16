/**
 * SMOKE 53 — Hepsiburada özeti + Trendyol'la birleşik pazaryeri özeti
 *
 * Ağ YOK, DB YOK: sahte HB sipariş görünümü ve sahte muhasebe kayıtları (HB'nin ham
 * biçiminde) enjekte edilir; Trendyol tarafı da smoke 48 gibi enjekte edilir.
 *
 * Senaryo:
 *   1. buildHepsiburadaInsights (saf): satış / iptal / iade ayrımı; kesin komisyon,
 *      kargo, işlem bedeli; kaydı olmayan siparişte tahmin (oran × 1,2 KDV, ortalama
 *      kargo/bedel — iadeli sipariş ortalamaya girmez); siparişe bağlı olmayan fatura;
 *      KDV, stopaj, sana kalan; karşılaştırma.
 *   2. HB listesinin 30 gününden eski sipariş muhasebeden türetilir (geçen ay) ve
 *      SKU eşleşmesiyle aynı ürün anahtarına + fotoğrafa düşer.
 *   3. Ödemeler: her salı; eksi bakiye sonraki salıya devreder; henüz ödemeye
 *      yansımayan sipariş tahmini; hesaba yatan (TotalPayment) dökümü.
 *   4. loadHbFinance: ≤1 aylık pencereler, sayfalama, id ile tekilleştirme.
 *   5. getMarketplaceInsights: iki kanal birleşir (ürün aynı barkodla birleşir,
 *      ödeme sırası kanal etiketli); HB düşerse / bağlı değilse Trendyol'la devam;
 *      ikisi de düşerse hata.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/53-marketplace-insights.ts
 */

import {
  buildHepsiburadaInsights,
  loadHbFinance,
  nextPayoutDay,
  normalizeHbRecord,
  type HbFinanceData,
} from "../../src/services/hepsiburada/insights.service.js";
import { getMarketplaceInsights } from "../../src/services/marketplace-insights.service.js";
import { trDayKey } from "../../src/services/trendyol/insights.service.js";
import type { DisplayOrder, MarketplaceChannel, OrderTab } from "../../src/services/trendyol/orders.service.js";
import type { HepsiburadaFinanceTransaction, HepsiburadaTransactionsQuery } from "../../src/services/hepsiburada/client.js";
import type { GetFinanceParams, TrendyolFinanceRecord, TrendyolFinanceResponse } from "../../src/services/trendyol/client.js";
import { section, step, assert, assertEqual, assertRejects, closePool, ok } from "./_shared.js";

const DAY = 86_400_000;
// İstanbul saatiyle tarih → ms (UTC+3).
const tr = (y: number, m: number, d: number, h = 12, min = 0): number => Date.UTC(y, m - 1, d, h - 3, min);
// HB muhasebe tarihi biçimi: saat dilimsiz İstanbul günü.
const hbDay = (m: number, d: number) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00`;

function near(actual: number, expected: number, label: string, tol = 0.05): void {
  assert(Math.abs(actual - expected) <= tol, `${label}: ${actual} ≈ ${expected}`);
}

function order(p: {
  channel?: MarketplaceChannel;
  no: string;
  tab: OrderTab;
  status?: string;
  date: number;
  amount: number;
  barcode: string;
  name: string;
  comm?: number;
}): DisplayOrder {
  const channel = p.channel ?? "hepsiburada";
  return {
    id: `${channel === "hepsiburada" ? "hb:" : ""}${p.no}::P`,
    channel,
    orderNumber: p.no,
    packageId: `P-${p.no}`,
    status: p.status ?? (p.tab === "diger" ? "Cancelled" : p.tab === "teslim" ? "Delivered" : "InTransit"),
    tab: p.tab,
    orderDate: p.date,
    agreedDeliveryDate: null,
    lastModifiedDate: null,
    buyerName: null,
    city: null,
    district: null,
    cargoProvider: null,
    cargoTrackingNumber: null,
    cargoTrackingLink: null,
    saleAmount: p.amount,
    discount: 0,
    billable: p.amount,
    invoiced: false,
    lines: [{
      lineId: `${p.no}-0`,
      barcode: p.barcode,
      quantity: 1,
      productName: p.name,
      merchantSku: null,
      color: null,
      size: null,
      unitPrice: p.amount,
      commissionRate: p.comm ?? null,
      vatRate: 20,
      matched: false,
      internalProductId: null,
      internalName: null,
      imageUrl: p.barcode === "LOTUS" ? "https://cdn.example/lotus.jpg" : null,
      channelTitle: null,
      productUrl: null,
    }],
  };
}

let seq = 0;
function rec(p: {
  type: string;
  order?: string;
  amount: number;
  status: "Paid" | "WillBePaid";
  due: [number, number];
  paid?: [number, number];
  orderDay?: [number, number];
  invoiceDay?: [number, number];
  sku?: string;
}): HepsiburadaFinanceTransaction {
  seq += 1;
  return {
    id: `R${seq}`,
    transactionType: p.type,
    status: p.status,
    sku: p.sku ?? (p.order ? "HBSKU1" : " "),
    packageNumber: p.order ? `K-${p.order}` : " ",
    orderNumber: p.order ?? "",
    invoiceNumber: `INV${seq}`,
    orderItemNumber: p.order ? "000010" : "0",
    quantity: p.order ? 1 : 0,
    amount: { value: p.amount, currencyCode: "949" },
    orderDate: p.orderDay ? hbDay(...p.orderDay) : "1900-01-01T00:00:00",
    // Kayıt (fatura) günü geçmiştedir; vade gelecekte olabilir.
    invoiceDate: hbDay(...(p.invoiceDay ?? p.orderDay ?? p.due)),
    dueDate: hbDay(...p.due),
    paymentDate: p.paid ? hbDay(...p.paid) : null,
    productName: p.order ? "Lotus Buhurdanlık" : undefined,
  };
}

const NOW = tr(2026, 11, 17, 12); // Salı

// ── HB sipariş görünümü (son ~30 gün) ──
const HB_ORDERS: DisplayOrder[] = [
  order({ no: "HB-A", tab: "tasima", date: tr(2026, 11, 14), amount: 349, barcode: "LOTUS", name: "Lotus", comm: 22 }),
  order({ no: "HB-B", tab: "teslim", date: tr(2026, 11, 10), amount: 349, barcode: "LOTUS", name: "Lotus", comm: 22 }),
  order({ no: "HB-C", tab: "teslim", date: tr(2026, 11, 12), amount: 139, barcode: "TUTSU", name: "Tütsü", comm: 22 }),
  order({ no: "HB-D", tab: "diger", date: tr(2026, 11, 11), amount: 349, barcode: "LOTUS", name: "Lotus", comm: 22 }),
  order({ no: "HB-E", tab: "teslim", status: "Delivered", date: tr(2026, 11, 3), amount: 349, barcode: "LOTUS", name: "Lotus", comm: 22 }),
  order({ no: "HB-F", tab: "teslim", date: tr(2026, 11, 2), amount: 349, barcode: "LOTUS", name: "Lotus", comm: 22 }),
];

// ── HB muhasebe kayıtları (ham biçim) ──
const RAW: HepsiburadaFinanceTransaction[] = [
  // HB-B: tam kayıt (ödenecek). Satış Cuma, kesintiler Salı vadeli.
  rec({ type: "Payment", order: "HB-B", amount: 349, status: "WillBePaid", due: [11, 20], orderDay: [11, 10] }),
  rec({ type: "Stoppage", order: "HB-B", amount: -2.91, status: "WillBePaid", due: [11, 20], orderDay: [11, 10] }),
  rec({ type: "Commission", order: "HB-B", amount: -92.14, status: "WillBePaid", due: [11, 24], orderDay: [11, 10] }),
  rec({ type: "ShipmentCostSharingExpense", order: "HB-B", amount: -112.74, status: "WillBePaid", due: [11, 24], orderDay: [11, 10] }),
  rec({ type: "ProcessingFeeExpense", order: "HB-B", amount: -13.19, status: "WillBePaid", due: [11, 24], orderDay: [11, 10] }),
  rec({ type: "PaymentServiceCostReflection", order: "HB-B", amount: -2.8, status: "WillBePaid", due: [11, 24], orderDay: [11, 10] }),
  // HB-C: yalnız satış + stopaj (faturalar henüz kesilmedi) → komisyon/kargo tahmin.
  rec({ type: "Payment", order: "HB-C", amount: 139, status: "WillBePaid", due: [11, 18], orderDay: [11, 12], sku: "HBSKU2" }),
  rec({ type: "Stoppage", order: "HB-C", amount: -1.16, status: "WillBePaid", due: [11, 18], orderDay: [11, 12], sku: "HBSKU2" }),
  // HB-E: iade edildi (3 kargo kaydı: gidiş, dönüş, yeniden) — ortalamaya girmemeli.
  rec({ type: "Payment", order: "HB-E", amount: 349, status: "Paid", due: [11, 3], paid: [11, 3], orderDay: [11, 3] }),
  rec({ type: "Return", order: "HB-E", amount: -349, status: "Paid", due: [11, 3], paid: [11, 3], orderDay: [11, 3] }),
  rec({ type: "ShipmentCostSharingExpense", order: "HB-E", amount: -112.74, status: "Paid", due: [11, 3], paid: [11, 3], orderDay: [11, 3] }),
  rec({ type: "ShipmentCostSharingExpense", order: "HB-E", amount: -110.81, status: "Paid", due: [11, 3], paid: [11, 3], orderDay: [11, 3] }),
  rec({ type: "ShipmentCostSharingExpense", order: "HB-E", amount: -112.74, status: "Paid", due: [11, 3], paid: [11, 3], orderDay: [11, 3] }),
  // HB-F: komisyon + kargo bugün (Salı) vadeli, satış 1 Aralık → bugünün bakiyesi eksi, devreder.
  rec({ type: "Commission", order: "HB-F", amount: -92.14, status: "WillBePaid", due: [11, 17], orderDay: [11, 2] }),
  rec({ type: "ShipmentCostSharingExpense", order: "HB-F", amount: -112.74, status: "WillBePaid", due: [11, 17], orderDay: [11, 2] }),
  rec({ type: "Payment", order: "HB-F", amount: 349, status: "WillBePaid", due: [12, 1], orderDay: [11, 2] }),
  rec({ type: "Stoppage", order: "HB-F", amount: -2.91, status: "WillBePaid", due: [12, 1], orderDay: [11, 2] }),
  // HB-OLD: HB listesinin 30 gününden eski (görünümde yok) — 10 Kasım'da ödendi.
  rec({ type: "Payment", order: "HB-OLD", amount: 349, status: "Paid", due: [11, 10], paid: [11, 10], orderDay: [10, 9] }),
  rec({ type: "Stoppage", order: "HB-OLD", amount: -2.91, status: "Paid", due: [11, 10], paid: [11, 10], orderDay: [10, 9] }),
  rec({ type: "Commission", order: "HB-OLD", amount: -92.14, status: "Paid", due: [11, 10], paid: [11, 10], orderDay: [10, 9] }),
  rec({ type: "ShipmentCostSharingExpense", order: "HB-OLD", amount: -107.9, status: "Paid", due: [11, 10], paid: [11, 10], orderDay: [10, 9] }),
  rec({ type: "ProcessingFeeExpense", order: "HB-OLD", amount: -13.19, status: "Paid", due: [11, 10], paid: [11, 10], orderDay: [10, 9] }),
  rec({ type: "PaymentServiceCostReflection", order: "HB-OLD", amount: -2.8, status: "Paid", due: [11, 10], paid: [11, 10], orderDay: [10, 9] }),
  // Hesaba yatan (işaret HB'de eksi gelir) + siparişsiz fatura.
  rec({ type: "TotalPayment", amount: -130.06, status: "Paid", due: [11, 10], paid: [11, 10] }),
  rec({ type: "EInvoiceSales", amount: -75, status: "Paid", due: [11, 3], paid: [11, 3], invoiceDay: [11, 3] }),
];

const FINANCE: HbFinanceData = { available: true, coverageStart: tr(2026, 9, 1, 0), records: RAW.map(normalizeHbRecord) };

// ── Trendyol tarafı (birleşik özet için) ──
const TY_ORDERS: DisplayOrder[] = [
  order({ channel: "trendyol", no: "TY-1", tab: "teslim", date: tr(2026, 11, 12), amount: 1000, barcode: "LOTUS", name: "Lotus", comm: 15 }),
];
const TY_SALES: TrendyolFinanceRecord[] = [
  { id: "S1", transactionType: "Sale", orderNumber: "TY-1", credit: 1000, commissionAmount: 150, sellerRevenue: 850,
    transactionDate: tr(2026, 11, 14), paymentDate: tr(2026, 11, 19, 0, 0), paymentOrderId: null },
];
const tyDeps = {
  listOrders: async () => ({ orders: TY_ORDERS, tabCounts: {}, total: TY_ORDERS.length }),
  fetchSettlements: async (p: GetFinanceParams): Promise<TrendyolFinanceResponse> => ({
    page: 0, totalPages: 1,
    content: TY_SALES.filter(r => r.transactionType === p.transactionType && (r.transactionDate ?? 0) >= p.startDate && (r.transactionDate ?? 0) < p.endDate),
  }),
  fetchOtherFinancials: async (): Promise<TrendyolFinanceResponse> => ({ content: [] }),
  fetchCargoItems: async () => ({ content: [] }),
};
const hbDeps = {
  listOrders: async () => ({ orders: HB_ORDERS, tabCounts: {}, total: HB_ORDERS.length, configured: true }),
  fetchTransactions: async (q: HepsiburadaTransactionsQuery) => {
    // Kayıtları fatura gününe göre pencereye düşür (uçlar dahil); sayfa = offset/limit.
    const from = q.recordDateStart ?? "";
    const to = q.recordDateEnd ?? "";
    const rows = RAW.filter(r => (r.invoiceDate ?? "").slice(0, 10) >= from && (r.invoiceDate ?? "").slice(0, 10) <= to);
    return { count: rows.length, items: rows.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100)) };
  },
};

async function run(): Promise<void> {
  section("SMOKE 53 — Hepsiburada özeti + birleşik pazaryeri özeti");

  // ── 1. Bu ay (HB) ──
  step("buildHepsiburadaInsights: bu ay");
  const ay = buildHepsiburadaInsights({ period: "ay", now: NOW, orders: HB_ORDERS, finance: FINANCE });
  assertEqual(ay.sales.total, 1186, "satış = A + B + C + F (iptal D ve iade E hariç)");
  assertEqual(ay.sales.orders, 4, "4 sipariş");
  assertEqual(ay.sales.cancelled.orders, 1, "1 iptal (diğer sekmesi)");
  assertEqual(ay.sales.returned.orders, 1, "1 iade (muhasebede Return)");
  assertEqual(ay.sales.returned.total, 349, "iade tutarı");
  assertEqual(ay.sales.prevTotal, 349, "Ekim 1–17: yalnız muhasebeden gelen eski sipariş");
  assertEqual(ay.sales.deltaPct, 240, "önceki döneme göre +%240");
  const b = ay.breakdown;
  near(b.commission, 313.11, "komisyon = B 92,14 + F 92,14 kesin + A 349×%22×1,2 + C 139×%22×1,2");
  near(b.avgCargo ?? 0, 111.13, "kargo ortalaması iadeli sipariş olmadan (B, F, OLD)");
  near(b.cargo, 447.73, "kargo = B + F kesin + A, C ortalama");
  near(b.otherFees, 138.96, "diğer = 4 × 15,99 (kesin + ortalama) + siparişsiz 75 TL fatura");
  near(b.vat.sales, 197.67, "satış KDV'si");
  near(b.vat.net, 47.7, "net KDV");
  near(b.stoppage, 9.88, "stopaj %1 (KDV hariç)");
  near(b.remaining, 228.61, "sana kalan", 0.1);
  assertEqual(b.settledOrders, 2, "B ve F kesin (komisyon + kargo kaydı var)");
  assertEqual(b.estimatedOrders, 2, "A (kaydı yok) ve C (yalnız satış kaydı) tahmini");
  assertEqual(b.avgCommissionRate, 22, "ortalama oran (KDV hariç)");
  assert(b.commissionVatAdded === true, "HB komisyonuna KDV eklendiği işaretli");
  assertEqual(ay.products.top[0].barcode, "LOTUS", "en çok satan lotus");
  assertEqual(ay.products.top[0].quantity, 3, "lotus 3 adet");

  // ── 2. Geçen ay: muhasebeden türetilen sipariş ──
  step("Geçen ay: HB listesinde olmayan eski sipariş muhasebeden gelir");
  const gecen = buildHepsiburadaInsights({ period: "gecen", now: NOW, orders: HB_ORDERS, finance: FINANCE });
  assertEqual(gecen.sales.total, 349, "Ekim satışı = HB-OLD");
  assertEqual(gecen.sales.daily.find(d => d.date === "2026-10-09")?.total, 349, "9 Ekim'e düşer");
  assertEqual(gecen.products.top[0].barcode, "LOTUS", "HB SKU'su görünümdeki barkoda eşlenir");
  assertEqual(gecen.products.top[0].imageUrl, "https://cdn.example/lotus.jpg", "fotoğraf da gelir");
  near(gecen.breakdown.commission, 92.14, "komisyon kesin");
  near(gecen.breakdown.cargo, 107.9, "kargo kesin");
  assertEqual(gecen.breakdown.estimatedOrders, 0, "tahmin yok");

  // ── 3. Ödemeler ──
  step("Ödemeler: salı günleri, eksi bakiye devri, yansımayan sipariş, geçmiş döküm");
  assertEqual(trDayKey(nextPayoutDay(tr(2026, 11, 20))), "2026-11-24", "Cuma vadesi → sonraki salı");
  assertEqual(trDayKey(nextPayoutDay(tr(2026, 11, 17))), "2026-11-17", "Salı vadesi → aynı gün");
  const p = ay.payments;
  assertEqual(p.next?.date, tr(2026, 11, 24, 0), "bugünün bakiyesi eksi → ilk ödeme 24 Kasım");
  near(p.next?.amount ?? 0, 58.18, "24 Kasım = C 137,84 + B 346,09 − B kesintileri 220,87 − devreden 204,88");
  assertEqual(p.next?.orders, 2, "B ve C");
  assertEqual(p.next?.channel, "hepsiburada", "kanal etiketi");
  assertEqual(p.later?.date, tr(2026, 12, 1, 0), "sonraki: 1 Aralık");
  near(p.later?.amount ?? 0, 346.09, "F'nin satışı");
  assertEqual(p.notDelivered.orders, 1, "yalnız A ödemeye yansımadı");
  near(p.notDelivered.amount, 126.84, "349 − komisyon − ort. kargo − ort. bedel − stopaj");
  assertEqual(p.past.length, 1, "1 hesaba yatan");
  assertEqual(p.past[0].amount, 130.06, "işaret düzeltilir");
  assertEqual(p.past[0].sales, 349, "döküm: satış");
  assertEqual(p.past[0].commission, 92.14, "döküm: komisyon");
  assertEqual(p.past[0].deductions, 126.8, "döküm: kargo + diğer + stopaj");

  // ── 4. Muhasebe okuma ──
  step("loadHbFinance: ≤1 aylık pencereler, sayfalama, tekilleştirme");
  const calls: HepsiburadaTransactionsQuery[] = [];
  const many = Array.from({ length: 150 }, (_, i) => rec({ type: "Payment", order: `X${i}`, amount: 10, status: "Paid", due: [11, 3], paid: [11, 3], orderDay: [11, 1] }));
  const loaded = await loadHbFinance(tr(2026, 9, 1, 0), NOW, async (q) => {
    calls.push(q);
    const rows = q.recordDateStart === "2026-09-01" ? many : many.slice(0, 5); // diğer pencereler aynı kayıtları tekrar döner
    return { count: rows.length, items: rows.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100)) };
  });
  const spans = calls.map(c => (Date.parse(`${c.recordDateEnd}T00:00:00Z`) - Date.parse(`${c.recordDateStart}T00:00:00Z`)) / DAY);
  assert(spans.every(d => d <= 28), `her pencere ≤ 28 gün (${spans.join(", ")})`);
  assertEqual(calls.map(c => c.recordDateStart ?? "").sort()[0], "2026-09-01", "iki ay önceki ayın başından");
  assertEqual(calls.map(c => c.recordDateEnd ?? "").sort().pop(), "2026-11-17", "bugüne kadar");
  assert(calls.filter(c => c.recordDateStart === "2026-09-01").length === 2, "100'lük sayfalar");
  assertEqual(loaded.records.length, 150, "kayıtlar id ile tekilleşir");
  const down = await loadHbFinance(tr(2026, 9, 1, 0), NOW, async () => { throw new Error("HB 503"); });
  assert(!down.available, "muhasebe düşerse available=false");
  const noFin = buildHepsiburadaInsights({ period: "ay", now: NOW, orders: HB_ORDERS, finance: down });
  near(noFin.breakdown.commission, 4 * 92.136 + 36.696, "komisyon tamamen satır oranlarından (A, B, E, F + C)", 0.1);
  assertEqual(noFin.payments.next, null, "ödeme bilinmiyor");
  assertEqual(noFin.sales.returned.orders, 0, "iade bilinmiyor → E satış sayılır");

  // ── 5. Birleşik özet ──
  step("getMarketplaceInsights: Trendyol + Hepsiburada");
  const all = await getMarketplaceInsights("ay", { now: NOW, trendyol: tyDeps, hepsiburada: hbDeps });
  assertEqual(all.channels.join(","), "trendyol,hepsiburada", "iki kanal");
  assertEqual(all.failed.length, 0, "düşen kanal yok");
  assertEqual(all.sales.total, 2186, "satış toplamı");
  assertEqual(all.sales.orders, 5, "sipariş toplamı");
  assertEqual(all.sales.prevTotal, 349, "önceki dönem toplamı");
  assertEqual(all.sales.deltaPct, 526, "birleşik karşılaştırma");
  assertEqual(all.byChannel.hepsiburada?.sales.total, 1186, "kanal başına HB");
  assertEqual(all.byChannel.trendyol?.sales.total, 1000, "kanal başına TY");
  assertEqual(all.products.top[0].barcode, "LOTUS", "aynı barkod iki kanalda birleşir");
  assertEqual(all.products.top[0].quantity, 4, "3 HB + 1 TY");
  near(all.breakdown.commission, 463.11, "komisyon toplamı");
  near(
    all.breakdown.remaining,
    (all.byChannel.trendyol?.breakdown.remaining ?? 0) + (all.byChannel.hepsiburada?.breakdown.remaining ?? 0),
    "sana kalan = kanalların toplamı (KDV iki kanalda da pozitif)",
    0.05,
  );
  assertEqual(all.payments.next?.channel, "trendyol", "en erken ödeme TY (19 Kasım)");
  near(all.payments.next?.amount ?? 0, 850, "TY hakedişi");
  assertEqual(all.payments.queue.map(q => `${q.channel}:${q.kind}`).join(","), "trendyol:next,hepsiburada:next,hepsiburada:later", "ödeme sırası");
  near(all.payments.later?.amount ?? 0, 404.27, "sonrakiler toplamı");
  assertEqual(all.payments.later?.channel, "hepsiburada", "sonrakilerin hepsi HB");
  assertEqual(all.payments.past[0].channel, "hepsiburada", "geçmiş ödemeler kanal etiketli");

  step("Bir kanal düşerse / bağlı değilse diğeriyle devam");
  const hbDown = await getMarketplaceInsights("ay", {
    now: NOW, trendyol: tyDeps,
    hepsiburada: { ...hbDeps, listOrders: async () => { throw new Error("HB 503"); } },
  });
  assertEqual(hbDown.channels.join(","), "trendyol", "yalnız TY");
  assertEqual(hbDown.failed.join(","), "hepsiburada", "HB düştü");
  assertEqual(hbDown.sales.total, 1000, "TY satışı");
  const hbOff = await getMarketplaceInsights("ay", {
    now: NOW, trendyol: tyDeps,
    hepsiburada: { ...hbDeps, listOrders: async () => ({ orders: [], tabCounts: {}, total: 0, configured: false }) },
  });
  assertEqual(hbOff.channels.join(","), "trendyol", "HB bağlı değil → yalnız TY");
  assertEqual(hbOff.failed.length, 0, "bağlı olmamak hata değil");
  await assertRejects(
    () => getMarketplaceInsights("ay", {
      now: NOW,
      trendyol: { ...tyDeps, listOrders: async () => { throw Object.assign(new Error("TY 401"), { code: "TY_DOWN" }); } },
      hepsiburada: { ...hbDeps, listOrders: async () => { throw new Error("HB 503"); } },
    }),
    "TY_DOWN",
    "iki kanal da düşerse Trendyol'un hatası fırlatılır",
  );

  ok("SMOKE 53 tamam");
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
