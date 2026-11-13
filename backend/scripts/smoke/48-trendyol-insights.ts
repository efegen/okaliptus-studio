/**
 * SMOKE 48 — Trendyol özeti (Siparişler ekranı kart şeridi + detaylar)
 *
 * Ağ YOK, DB YOK: getTrendyolInsights'a sahte sipariş listesi ve sahte ekstre
 * fetcher'ları enjekte edilir. CANLI Trendyol'a hiç çıkılmaz.
 *
 * Senaryo:
 *   1. periodRange (saf): hafta Pazartesi 00:00, ay 1'i 00:00, geçen ay tam ay (İstanbul).
 *   2. buildTrendyolInsights (saf): satış / iptal / askıdaki ayrımı, kesin + tahmini
 *      komisyon, kargo faturası + ortalama, diğer kesintiler, KDV, stopaj, sana kalan,
 *      karşılaştırma yüzdesi, en çok satanlar, gün gün satış.
 *   3. Ödemeler: sıradaki ödeme (paymentDate gruplu, bilinen kargo düşülmüş), teslim
 *      edilmemiş tahmini, geçmiş ödeme dökümü (paymentOrderId).
 *   4. getTrendyolInsights (enjekte): ekstre ≤15 günlük pencerelerle, tek
 *      transactionType ile istenir; kargo kalemleri yalnız "Kargo" faturası için çekilir.
 *   5. Ekstre düşerse: financeAvailable=false, komisyon satır oranından tahmin, uç çalışır.
 *   6. parseInsightPeriod doğrulaması.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/48-trendyol-insights.ts
 */

import {
  buildTrendyolInsights,
  getTrendyolInsights,
  parseInsightPeriod,
  periodRange,
  trDayKey,
  EMPTY_FINANCE,
  type FinanceData,
} from "../../src/services/trendyol/insights.service.js";
import type { DisplayOrder, OrderTab } from "../../src/services/trendyol/orders.service.js";
import type {
  GetFinanceParams,
  TrendyolFinanceRecord,
  TrendyolFinanceResponse,
} from "../../src/services/trendyol/client.js";
import { section, step, assert, assertEqual, assertRejects, closePool, ok } from "./_shared.js";

const DAY = 86_400_000;
// İstanbul saatiyle tarih → ms (UTC+3).
const tr = (y: number, m: number, d: number, h = 12, min = 0): number => Date.UTC(y, m - 1, d, h - 3, min);

function near(actual: number, expected: number, label: string, tol = 0.05): void {
  assert(Math.abs(actual - expected) <= tol, `${label}: ${actual} ≈ ${expected}`);
}

function order(p: {
  no: string;
  status: string;
  tab: OrderTab;
  date: number;
  billable: number;
  lines: Array<{ barcode: string; name: string; qty: number; price: number; vat?: number; comm?: number }>;
}): DisplayOrder {
  return {
    id: `${p.no}::P`,
    channel: "trendyol",
    orderNumber: p.no,
    packageId: "P",
    status: p.status,
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
    saleAmount: p.billable,
    discount: 0,
    billable: p.billable,
    invoiced: false,
    lines: p.lines.map((l, i) => ({
      lineId: `${p.no}-${i}`,
      barcode: l.barcode,
      quantity: l.qty,
      productName: l.name,
      merchantSku: null,
      color: null,
      size: null,
      unitPrice: l.price,
      commissionRate: l.comm ?? null,
      vatRate: l.vat ?? 20,
      matched: false,
      internalProductId: null,
      internalName: null,
      imageUrl: l.barcode === "MAT" ? "https://cdn.example/mat.jpg" : null,
      channelTitle: null,
      productUrl: null,
    })),
  };
}

const NOW = tr(2026, 11, 13, 12); // Cuma

const ORDERS: DisplayOrder[] = [
  order({ no: "TY-A", status: "Created", tab: "yeni", date: tr(2026, 11, 10), billable: 1200,
    lines: [{ barcode: "MAT", name: "Yoga Matı", qty: 2, price: 600, comm: 15 }] }),
  order({ no: "TY-B", status: "Delivered", tab: "teslim", date: tr(2026, 11, 3), billable: 500,
    lines: [{ barcode: "TUTSU", name: "Tütsü", qty: 1, price: 500, comm: 10 }] }),
  order({ no: "TY-C", status: "Cancelled", tab: "diger", date: tr(2026, 11, 5), billable: 300,
    lines: [{ barcode: "BLOK", name: "Blok", qty: 1, price: 300 }] }),
  order({ no: "TY-D", status: "Awaiting", tab: "aski", date: tr(2026, 11, 12), billable: 900,
    lines: [{ barcode: "MAT", name: "Yoga Matı", qty: 1, price: 900 }] }),
  order({ no: "TY-E", status: "Delivered", tab: "teslim", date: tr(2026, 10, 10), billable: 1000,
    lines: [{ barcode: "MAT", name: "Yoga Matı", qty: 1, price: 1000, comm: 10 }] }),
  order({ no: "TY-F", status: "Delivered", tab: "teslim", date: tr(2026, 10, 20), billable: 800,
    lines: [{ barcode: "BLOK", name: "Blok", qty: 2, price: 400, comm: 12 }] }),
];

const SALES: TrendyolFinanceRecord[] = [
  { id: "S1", transactionType: "Sale", orderNumber: "TY-B", credit: 500, commissionAmount: 50, sellerRevenue: 450,
    transactionDate: tr(2026, 11, 8), paymentDate: tr(2026, 11, 18, 0, 0), paymentOrderId: null },
  { id: "S2", transactionType: "Sale", orderNumber: "TY-E", credit: 1000, commissionAmount: 100, sellerRevenue: 900,
    transactionDate: tr(2026, 10, 15), paymentDate: tr(2026, 11, 4, 0, 0), paymentOrderId: "PO1" },
];
const DEDUCTIONS: TrendyolFinanceRecord[] = [
  { id: "KF1", transactionType: "DeductionInvoices", description: "Kargo Fatura", debt: 85, transactionDate: tr(2026, 11, 2) },
  { id: "HB1", transactionType: "DeductionInvoices", description: "Platform Hizmet Bedeli", debt: 24, transactionDate: tr(2026, 11, 6) },
];
const PAYMENTS: TrendyolFinanceRecord[] = [
  { id: "PO1", transactionType: "PaymentOrder", debt: 855, transactionDate: tr(2026, 11, 4) },
];

const FINANCE: FinanceData = {
  available: true,
  sales: SALES,
  returns: [],
  deductions: DEDUCTIONS,
  payments: PAYMENTS,
  cargoByOrder: new Map([["TY-B", 40], ["TY-E", 45]]),
  cargoItemCount: 2,
  cargoItemTotal: 85,
};

async function run(): Promise<void> {
  section("SMOKE 48 — Trendyol özeti (insights)");

  // ── 1. Dönem aralıkları ──
  step("periodRange: hafta / ay / geçen ay (İstanbul)");
  const w = periodRange("hafta", NOW);
  assertEqual(trDayKey(w.start), "2026-11-09", "hafta Pazartesi başlar");
  assertEqual(w.start, tr(2026, 11, 9, 0), "hafta 00:00'da başlar");
  const m = periodRange("ay", NOW);
  assertEqual(m.start, tr(2026, 11, 1, 0), "ay 1'inde başlar");
  assertEqual(m.prevStart, tr(2026, 10, 1, 0), "karşılaştırma önceki ayın başı");
  assertEqual(m.prevEnd, tr(2026, 10, 13, 12), "karşılaştırma aynı gün sayısı kadar");
  const g = periodRange("gecen", NOW);
  assertEqual(g.start, tr(2026, 10, 1, 0), "geçen ay Ekim 1");
  assertEqual(g.end, tr(2026, 11, 1, 0), "geçen ay Kasım 1'de biter");
  assert(g.complete, "geçen ay tamamlanmış dönem");

  // ── 2. Bu ay ──
  step("buildTrendyolInsights: bu ay");
  const ay = buildTrendyolInsights({ period: "ay", now: NOW, orders: ORDERS, finance: FINANCE });
  assertEqual(ay.sales.total, 1700, "satış = A + B (iptal ve askıdaki hariç)");
  assertEqual(ay.sales.orders, 2, "2 sipariş");
  assertEqual(ay.sales.units, 3, "3 ürün");
  assertEqual(ay.sales.cancelled.orders, 1, "1 iptal");
  assertEqual(ay.sales.cancelled.total, 300, "iptal tutarı");
  assertEqual(ay.sales.deltaPct, 70, "geçen ayın ilk 13 gününe göre +%70 (1000 → 1700)");
  assertEqual(ay.sales.daily.length, 13, "1–13 Kasım için 13 gün");
  assertEqual(ay.sales.daily.find(d => d.date === "2026-11-10")?.total, 1200, "10 Kasım günlük satış");
  const b = ay.breakdown;
  near(b.commission, 230, "komisyon = B kesin 50 + A tahmini 1200×%15");
  near(b.cargo, 82.5, "kargo = B faturadan 40 + A ortalama 42,5");
  near(b.otherFees, 24, "hizmet bedeli (kargo dışı fatura)");
  near(b.vat.sales, 283.33, "satış KDV'si");
  near(b.vat.deductible, 56.08, "faturalardaki indirilecek KDV");
  near(b.vat.net, 227.25, "net KDV");
  near(b.stoppage, 14.17, "stopaj %1 (KDV hariç)");
  near(b.remaining, 1122.08, "sana kalan", 0.1);
  assertEqual(b.remainingPct, 66, "satışın %66'sı");
  assertEqual(b.settledOrders, 1, "1 sipariş ekstrede kesin");
  assertEqual(b.estimatedOrders, 1, "1 sipariş tahmini");
  assert(b.financeAvailable, "ekstre okundu");
  assertEqual(ay.products.top[0].barcode, "MAT", "en çok satan mat (2 adet)");
  assertEqual(ay.products.top[0].quantity, 2, "mat 2 adet");
  assertEqual(ay.products.top[0].imageUrl, "https://cdn.example/mat.jpg", "ürün fotoğrafı taşınır");
  assertEqual(ay.products.count, 2, "2 farklı ürün");

  // ── 3. Ödemeler ──
  step("Ödemeler: sıradaki, teslim edilmemiş, geçmiş döküm");
  const p = ay.payments;
  assert(p.next !== null, "sıradaki ödeme var");
  assertEqual(p.next?.date, tr(2026, 11, 18, 0), "18 Kasım");
  near(p.next?.amount ?? 0, 410, "450 hakediş − 40 kargo");
  assertEqual(p.next?.orders, 1, "1 sipariş");
  assertEqual(p.later, null, "sonraki grup yok");
  near(p.notDelivered.amount, 977.5, "A: 1200 − 180 komisyon − 42,5 kargo");
  assertEqual(p.notDelivered.orders, 1, "1 teslim edilmemiş sipariş (askıdaki hariç)");
  assertEqual(p.past.length, 1, "1 geçmiş ödeme");
  assertEqual(p.past[0].amount, 855, "ödeme tutarı");
  assertEqual(p.past[0].sales, 1000, "döküm: satış");
  assertEqual(p.past[0].commission, 100, "döküm: komisyon");
  assertEqual(p.past[0].deductions, 45, "döküm: kesintiler");

  // ── Geçen ay + hafta ──
  step("Geçen ay ve bu hafta");
  const gecen = buildTrendyolInsights({ period: "gecen", now: NOW, orders: ORDERS, finance: FINANCE });
  assertEqual(gecen.sales.total, 1800, "Ekim satışı E + F");
  near(gecen.breakdown.commission, 196, "E kesin 100 + F tahmini 800×%12");
  assertEqual(gecen.sales.deltaPct, null, "Eylül verisi yok → karşılaştırma yok");
  const hafta = buildTrendyolInsights({ period: "hafta", now: NOW, orders: ORDERS, finance: FINANCE });
  assertEqual(hafta.sales.total, 1200, "hafta: yalnız A (D askıda)");
  assertEqual(hafta.sales.daily.length, 5, "Pazartesi–Cuma");

  // ── 4. Enjekte uç akışı ──
  step("getTrendyolInsights: ekstre ≤15 günlük pencerelerle istenir");
  const calls: Array<{ kind: string; p: GetFinanceParams }> = [];
  const respond = (records: TrendyolFinanceRecord[], p: GetFinanceParams): TrendyolFinanceResponse => ({
    page: 0, totalPages: 1,
    content: records.filter(r => r.transactionType === p.transactionType
      && (r.transactionDate ?? 0) >= p.startDate && (r.transactionDate ?? 0) < p.endDate),
  });
  const cargoCalls: string[] = [];
  const data = await getTrendyolInsights("ay", {
    now: NOW,
    listOrders: async () => ({ orders: ORDERS, tabCounts: {}, total: ORDERS.length }),
    fetchSettlements: async (prm) => { calls.push({ kind: "settlements", p: prm }); return respond(SALES, prm); },
    fetchOtherFinancials: async (prm) => {
      calls.push({ kind: "other", p: prm });
      return respond([...DEDUCTIONS, ...PAYMENTS], prm);
    },
    fetchCargoItems: async (serial) => {
      cargoCalls.push(serial);
      return { page: 0, totalPages: 1, content: [
        { orderNumber: "TY-B", amount: 40, desi: 3 },
        { orderNumber: "TY-E", amount: 45, desi: 4 },
      ] };
    },
  });
  assert(calls.length > 0, "ekstre çağrıldı");
  assert(calls.every(c => c.p.endDate - c.p.startDate <= 15 * DAY), "her istek ≤ 15 gün");
  assert(calls.every(c => c.p.startDate >= tr(2026, 10, 1, 0)), "pencere önceki ayın başından başlar");
  const types = new Set(calls.map(c => `${c.kind}:${c.p.transactionType}`));
  assertEqual(
    [...types].sort().join(","),
    "other:DeductionInvoices,other:PaymentOrder,settlements:Return,settlements:Sale",
    "dört transactionType ayrı ayrı istenir",
  );
  assertEqual(cargoCalls.join(","), "KF1", "yalnız kargo faturasının kalemleri çekilir");
  near(data.breakdown.remaining, ay.breakdown.remaining, "enjekte akış saf çekirdekle aynı sonucu verir", 0.01);

  // ── 5. Ekstre düşerse ──
  step("Ekstre alınamazsa uç yine çalışır (tahminle)");
  const down = await getTrendyolInsights("ay", {
    now: NOW,
    listOrders: async () => ({ orders: ORDERS, tabCounts: {}, total: ORDERS.length }),
    fetchSettlements: async () => { throw new Error("TY 503"); },
    fetchOtherFinancials: async () => ({ content: [] }),
    fetchCargoItems: async () => ({ content: [] }),
  });
  assert(!down.breakdown.financeAvailable, "financeAvailable=false");
  near(down.breakdown.commission, 230, "komisyon satır oranlarından: 1200×%15 + 500×%10");
  assertEqual(down.breakdown.cargo, 0, "kargo bilinmiyor → 0");
  assertEqual(down.payments.next, null, "sıradaki ödeme bilinmiyor");
  const empty = buildTrendyolInsights({ period: "ay", now: NOW, orders: [], finance: EMPTY_FINANCE });
  assertEqual(empty.sales.total, 0, "boş veri: satış 0");
  assertEqual(empty.breakdown.remainingPct, null, "boş veri: oran yok");

  // ── 6. Dönem parametresi ──
  step("parseInsightPeriod");
  assertEqual(parseInsightPeriod(undefined), "ay", "varsayılan ay");
  assertEqual(parseInsightPeriod("hafta"), "hafta", "hafta");
  await assertRejects(async () => { parseInsightPeriod("yil"); }, "VALIDATION_ERROR", "geçersiz dönem reddedilir");

  ok("SMOKE 48 tamam");
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
