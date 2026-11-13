// Trendyol özeti (mobil Siparişler ekranının üstündeki kart şeridi + detayları).
//
// SALT-OKUMA. İki kaynağı birleştirir:
//   1. Sipariş görünümü (orders.service listTrendyolOrders, 90 günlük snapshot — poller
//      sıcak tutar): satış, sipariş sayısı, gün gün satış, en çok satanlar, satır KDV
//      ve komisyon ORANLARI.
//   2. Cari hesap ekstresi (client getSettlements / getOtherFinancials /
//      getCargoInvoiceItems): kesinleşmiş komisyon, kargo faturası (paket başı),
//      hizmet bedeli vb. kesintiler ve ödemeler. Ekstre kaydı sipariş TESLİM
//      edildikten sonra oluşur → teslim edilmemiş siparişlerin komisyonu satırdaki
//      orandan, kargosu bilinen paketlerin ortalamasından TAHMİN edilir.
//
// "Sana kalan" = satış − komisyon − kargo − diğer kesintiler − stopaj − net KDV.
// Ürün alış maliyeti panelde tutulmadığı için bu "kâr" değildir.
// Hiçbir şey yazılmaz; ekstre okuması 10 dk süreç-içi önbellekte tutulur.

import {
  getCargoInvoiceItems as defaultGetCargoInvoiceItems,
  getOtherFinancials as defaultGetOtherFinancials,
  getSettlements as defaultGetSettlements,
  type GetFinanceParams,
  type TrendyolCargoInvoiceResponse,
  type TrendyolFinanceRecord,
  type TrendyolFinanceResponse,
} from "./client.js";
import { listTrendyolOrders, type DisplayOrder, type OrdersListResult } from "./orders.service.js";
import { ValidationError } from "../errors.js";

export type InsightPeriod = "hafta" | "ay" | "gecen";
export const INSIGHT_PERIODS: readonly InsightPeriod[] = ["hafta", "ay", "gecen"];

const DAY = 86_400_000;
// Europe/Istanbul = UTC+3 sabit (2016'dan beri yaz saati yok). Hafta Pazartesi 00:00.
const TR_OFFSET = 3 * 3_600_000;
const ORDERS_WINDOW_DAYS = 90;
const DEFAULT_VAT_RATE = 20;     // satırda KDV oranı yoksa
const SERVICE_VAT_RATE = 20;     // komisyon / kargo / hizmet faturalarındaki KDV
const STOPPAGE_RATE = 0.01;      // e-ticaret stopajı (KDV hariç tutar üzerinden)
const FINANCE_TTL_MS = 10 * 60_000;
const FINANCE_CHUNK_MS = 15 * DAY - 60_000; // TY: aralık en fazla 15 gün
const FINANCE_MAX_PAGES = 20;
const FINANCE_CONCURRENCY = 3;
const TOP_PRODUCTS_LIMIT = 20;
const PAST_PAYMENTS_LIMIT = 6;

const SALE_TABS = new Set(["yeni", "isleme", "tasima", "teslim", "yeniden"]);
const NOT_DELIVERED_TABS = new Set(["yeni", "isleme", "tasima", "yeniden"]);

// ── Tarih yardımcıları (İstanbul) ────────────────────────────────────────────

function trDayStart(ms: number): number {
  return Math.floor((ms + TR_OFFSET) / DAY) * DAY - TR_OFFSET;
}

function trParts(ms: number): { y: number; m: number; dow: number } {
  const d = new Date(ms + TR_OFFSET);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), dow: d.getUTCDay() };
}

// Date.UTC ay taşmasını (m = -1, 12) kendisi düzeltir.
function trMonthStart(y: number, m: number): number {
  return Date.UTC(y, m, 1) - TR_OFFSET;
}

export function trDayKey(ms: number): string {
  return new Date(ms + TR_OFFSET).toISOString().slice(0, 10);
}

export type PeriodRange = {
  start: number;     // dahil
  end: number;       // hariç (devam eden dönemde = now)
  prevStart: number; // karşılaştırma dönemi (aynı uzunlukta önceki dönem)
  prevEnd: number;
  complete: boolean; // dönem bitti mi (geçen ay)
};

export function periodRange(period: InsightPeriod, now: number): PeriodRange {
  const { y, m, dow } = trParts(now);
  if (period === "hafta") {
    const start = trDayStart(now) - ((dow + 6) % 7) * DAY;
    return { start, end: now, prevStart: start - 7 * DAY, prevEnd: now - 7 * DAY, complete: false };
  }
  if (period === "ay") {
    const start = trMonthStart(y, m);
    const prevStart = trMonthStart(y, m - 1);
    return { start, end: now, prevStart, prevEnd: Math.min(prevStart + (now - start), start), complete: false };
  }
  const start = trMonthStart(y, m - 1);
  const end = trMonthStart(y, m);
  return { start, end, prevStart: trMonthStart(y, m - 2), prevEnd: start, complete: true };
}

// ── Sayı yardımcıları ────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function abs(v: unknown): number {
  return Math.abs(num(v));
}

// ── Sipariş tarafı ───────────────────────────────────────────────────────────

type OrderClass = "sale" | "cancelled" | "returned" | "skip";

function classifyOrder(o: DisplayOrder): OrderClass {
  const s = (o.status ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (s === "cancelled" || s === "unsupplied") return "cancelled";
  if (s === "returned") return "returned";
  return SALE_TABS.has(o.tab) ? "sale" : "skip"; // Askıdaki (ödeme onayı bekleyen) sayılmaz
}

// Paketin müşteriye faturalanan tutarı (KDV dahil, satıcı indirimi düşülmüş).
function packageAmount(o: DisplayOrder): number {
  if (typeof o.billable === "number") return o.billable;
  if (typeof o.saleAmount === "number") return o.saleAmount - num(o.discount);
  return o.lines.reduce((s, l) => s + num(l.unitPrice) * l.quantity, 0);
}

type LineShare = {
  key: string;
  barcode: string | null;
  name: string;
  imageUrl: string | null;
  quantity: number;
  amount: number;
  vatRate: number;
  commissionRate: number | null;
};

// Paket tutarını satırlara (birim fiyat × adet oranında) dağıtır → indirim satırlara yayılır.
function lineShares(o: DisplayOrder, amount: number): LineShare[] {
  const gross = o.lines.map(l => num(l.unitPrice) * l.quantity);
  const total = gross.reduce((s, g) => s + g, 0);
  return o.lines.map((l, i) => ({
    key: l.barcode ?? l.productName ?? `satir-${i}`,
    barcode: l.barcode,
    name: l.internalName ?? l.channelTitle ?? l.productName ?? l.barcode ?? "Ürün",
    imageUrl: l.imageUrl,
    quantity: l.quantity,
    amount: total > 0 ? (amount * gross[i]) / total : amount / Math.max(1, o.lines.length),
    vatRate: typeof l.vatRate === "number" && l.vatRate >= 0 ? l.vatRate : DEFAULT_VAT_RATE,
    commissionRate: typeof l.commissionRate === "number" && l.commissionRate >= 0 ? l.commissionRate : null,
  }));
}

function inRange(ms: number | null, start: number, end: number): ms is number {
  return ms !== null && ms >= start && ms < end;
}

function salesTotal(orders: DisplayOrder[], start: number, end: number): number {
  let total = 0;
  for (const o of orders) {
    if (inRange(o.orderDate, start, end) && classifyOrder(o) === "sale") total += packageAmount(o);
  }
  return total;
}

// ── Ekstre tarafı ────────────────────────────────────────────────────────────

export type FinanceData = {
  available: boolean;
  sales: TrendyolFinanceRecord[];     // settlements Sale
  returns: TrendyolFinanceRecord[];   // settlements Return
  deductions: TrendyolFinanceRecord[]; // otherfinancials DeductionInvoices
  payments: TrendyolFinanceRecord[];  // otherfinancials PaymentOrder
  cargoByOrder: Map<string, number>;  // kargo faturası kalemleri → sipariş başı kargo
  cargoItemCount: number;
  cargoItemTotal: number;
};

export const EMPTY_FINANCE: FinanceData = {
  available: false,
  sales: [],
  returns: [],
  deductions: [],
  payments: [],
  cargoByOrder: new Map(),
  cargoItemCount: 0,
  cargoItemTotal: 0,
};

function isCargoInvoice(r: TrendyolFinanceRecord): boolean {
  return /kargo/i.test(r.description ?? "");
}

// ── Saf çekirdek ─────────────────────────────────────────────────────────────

export type TrendyolInsights = {
  period: InsightPeriod;
  range: { start: number; end: number; complete: boolean };
  generatedAt: number;
  sales: {
    total: number;
    orders: number;
    packages: number;
    units: number;
    avgOrder: number | null;
    deltaPct: number | null; // önceki eşdeğer döneme göre % (veri yoksa null)
    daily: Array<{ date: string; total: number; orders: number }>;
    cancelled: { orders: number; total: number };
    returned: { orders: number; total: number };
  };
  products: {
    count: number;
    top: Array<{ key: string; barcode: string | null; name: string; imageUrl: string | null; quantity: number; total: number }>;
  };
  breakdown: {
    sales: number;
    commission: number;
    cargo: number;
    otherFees: number;
    stoppage: number;
    vat: { sales: number; deductible: number; net: number };
    remaining: number;
    remainingPct: number | null;
    avgCommissionRate: number | null;
    cargoPackages: number;
    avgCargo: number | null;
    settledOrders: number;
    estimatedOrders: number; // komisyonu/kargosu tahmini olan (henüz teslim edilmemiş) sipariş
    financeAvailable: boolean;
  };
  payments: {
    available: boolean;
    next: { date: number; amount: number; orders: number } | null;
    later: { date: number; amount: number; orders: number } | null;
    notDelivered: { amount: number; orders: number };
    past: Array<{
      id: string;
      date: number;
      amount: number;
      orders: number | null;
      sales: number | null;
      commission: number | null;
      deductions: number | null;
    }>;
  };
};

export function buildTrendyolInsights(input: {
  period: InsightPeriod;
  now: number;
  orders: DisplayOrder[];
  finance: FinanceData;
}): TrendyolInsights {
  const { period, now, orders, finance } = input;
  const range = periodRange(period, now);
  const { start, end } = range;

  // ── Ekstre haritaları (sipariş no → kesinleşmiş komisyon / satış) ──
  const settled = new Map<string, { commission: number; credit: number }>();
  for (const r of finance.sales) {
    if (!r.orderNumber) continue;
    const cur = settled.get(r.orderNumber) ?? { commission: 0, credit: 0 };
    cur.commission += abs(r.commissionAmount);
    cur.credit += abs(r.credit);
    settled.set(r.orderNumber, cur);
  }
  for (const r of finance.returns) {
    if (!r.orderNumber) continue;
    const cur = settled.get(r.orderNumber);
    if (!cur) continue; // satış kaydı pencere dışında kalmış iade: ilgili sipariş zaten "iade" sayılır
    cur.commission -= abs(r.commissionAmount);
    cur.credit -= abs(r.debt);
  }
  let settledCommission = 0;
  let settledCredit = 0;
  for (const v of settled.values()) {
    settledCommission += Math.max(0, v.commission);
    settledCredit += Math.max(0, v.credit);
  }
  const ekstreRate = settledCredit > 0 ? (settledCommission / settledCredit) * 100 : null;
  const avgCargo = finance.cargoItemCount > 0 ? finance.cargoItemTotal / finance.cargoItemCount : null;

  // ── Dönem siparişleri ──
  let total = 0;
  let units = 0;
  let packages = 0;
  let salesVat = 0;
  let commission = 0;
  let cargo = 0;
  let cargoPackages = 0;
  let lineRateSum = 0;
  let lineRateWeight = 0;
  const orderNumbers = new Set<string>();
  const settledOrders = new Set<string>();
  const estimatedOrders = new Set<string>();
  const cargoCounted = new Set<string>();
  const cancelled = new Set<string>();
  const returned = new Set<string>();
  let cancelledTotal = 0;
  let returnedTotal = 0;
  const daily = new Map<string, { total: number; orders: Set<string> }>();
  const products = new Map<string, { key: string; barcode: string | null; name: string; imageUrl: string | null; quantity: number; total: number }>();
  const pending: Array<{ o: DisplayOrder; shares: LineShare[] }> = [];

  for (let d = trDayStart(start); d < end; d += DAY) {
    daily.set(trDayKey(d), { total: 0, orders: new Set() });
  }

  for (const o of orders) {
    if (!inRange(o.orderDate, start, end)) continue;
    const cls = classifyOrder(o);
    const amount = packageAmount(o);
    if (cls === "cancelled") { cancelled.add(o.orderNumber); cancelledTotal += amount; continue; }
    if (cls === "returned") { returned.add(o.orderNumber); returnedTotal += amount; continue; }
    if (cls !== "sale") continue;

    packages += 1;
    total += amount;
    orderNumbers.add(o.orderNumber);
    const dayBucket = daily.get(trDayKey(o.orderDate));
    if (dayBucket) { dayBucket.total += amount; dayBucket.orders.add(o.orderNumber); }

    const shares = lineShares(o, amount);
    for (const s of shares) {
      units += s.quantity;
      salesVat += (s.amount * s.vatRate) / (100 + s.vatRate);
      if (s.commissionRate !== null) { lineRateSum += s.commissionRate * s.amount; lineRateWeight += s.amount; }
      const p = products.get(s.key) ?? { key: s.key, barcode: s.barcode, name: s.name, imageUrl: s.imageUrl, quantity: 0, total: 0 };
      p.quantity += s.quantity;
      p.total += s.amount;
      if (!p.imageUrl && s.imageUrl) p.imageUrl = s.imageUrl;
      products.set(s.key, p);
    }

    // Komisyon: ekstrede varsa kesin (sipariş başına bir kez), yoksa tahmin (aşağıda).
    const st = settled.get(o.orderNumber);
    if (st) {
      if (!settledOrders.has(o.orderNumber)) commission += Math.max(0, st.commission);
      settledOrders.add(o.orderNumber);
    } else {
      estimatedOrders.add(o.orderNumber);
      pending.push({ o, shares });
    }

    // Kargo: kargo faturasında varsa kesin (sipariş başına bir kez), yoksa paket ortalaması.
    const known = finance.cargoByOrder.get(o.orderNumber);
    if (known !== undefined) {
      if (!cargoCounted.has(o.orderNumber)) cargo += known;
      cargoCounted.add(o.orderNumber);
    } else if (avgCargo !== null) {
      cargo += avgCargo;
    }
    cargoPackages += 1;
  }

  const lineRate = lineRateWeight > 0 ? lineRateSum / lineRateWeight : null;
  const fallbackRate = ekstreRate ?? lineRate;
  for (const { shares } of pending) {
    for (const s of shares) {
      const rate = s.commissionRate ?? fallbackRate;
      if (rate !== null) commission += (s.amount * rate) / 100;
    }
  }

  // Kargo faturası kalemleri okunamadıysa: dönemde kesilen kargo faturalarının toplamı.
  if (finance.cargoItemCount === 0) {
    for (const r of finance.deductions) {
      if (isCargoInvoice(r) && inRange(num(r.transactionDate) || null, start, end)) cargo += abs(r.debt) || abs(r.credit);
    }
  }

  // Diğer kesintiler (hizmet bedeli, reklam vb.): dönemde kesilen kargo DIŞI faturalar.
  let otherFees = 0;
  for (const r of finance.deductions) {
    if (isCargoInvoice(r)) continue;
    if (inRange(num(r.transactionDate) || null, start, end)) otherFees += abs(r.debt) || abs(r.credit);
  }

  const stoppage = Math.max(0, (total - salesVat) * STOPPAGE_RATE);
  const vatDeductible = ((commission + cargo + otherFees) * SERVICE_VAT_RATE) / (100 + SERVICE_VAT_RATE);
  const netVat = Math.max(0, salesVat - vatDeductible);
  const remaining = total - commission - cargo - otherFees - stoppage - netVat;

  // ── Karşılaştırma (önceki eşdeğer dönem; snapshot kapsıyorsa) ──
  const coverageStart = now - (ORDERS_WINDOW_DAYS - 1) * DAY;
  let deltaPct: number | null = null;
  if (range.prevStart >= coverageStart) {
    const prev = salesTotal(orders, range.prevStart, range.prevEnd);
    if (prev > 0) deltaPct = Math.round(((total - prev) / prev) * 100);
  }

  const top = [...products.values()]
    .sort((a, b) => b.quantity - a.quantity || b.total - a.total)
    .slice(0, TOP_PRODUCTS_LIMIT)
    .map(p => ({ ...p, total: round2(p.total) }));

  return {
    period,
    range: { start, end, complete: range.complete },
    generatedAt: now,
    sales: {
      total: round2(total),
      orders: orderNumbers.size,
      packages,
      units,
      avgOrder: orderNumbers.size > 0 ? round2(total / orderNumbers.size) : null,
      deltaPct,
      daily: [...daily.entries()].map(([date, v]) => ({ date, total: round2(v.total), orders: v.orders.size })),
      cancelled: { orders: cancelled.size, total: round2(cancelledTotal) },
      returned: { orders: returned.size, total: round2(returnedTotal) },
    },
    products: { count: products.size, top },
    breakdown: {
      sales: round2(total),
      commission: round2(commission),
      cargo: round2(cargo),
      otherFees: round2(otherFees),
      stoppage: round2(stoppage),
      vat: { sales: round2(salesVat), deductible: round2(vatDeductible), net: round2(netVat) },
      remaining: round2(remaining),
      remainingPct: total > 0 ? Math.round((remaining / total) * 100) : null,
      avgCommissionRate: fallbackRate !== null ? round2(fallbackRate) : null,
      cargoPackages,
      avgCargo: avgCargo !== null ? round2(avgCargo) : null,
      settledOrders: settledOrders.size,
      estimatedOrders: estimatedOrders.size,
      financeAvailable: finance.available,
    },
    payments: buildPayments(orders, finance, now, fallbackRate),
  };
}

function buildPayments(
  orders: DisplayOrder[],
  finance: FinanceData,
  now: number,
  fallbackRate: number | null,
): TrendyolInsights["payments"] {
  // Ödeme günü gelmemiş (teslim edilmiş) siparişler → ödeme günlerine göre grupla.
  const today = trDayStart(now);
  const upcoming = new Map<number, { amount: number; orders: Set<string> }>();
  const add = (r: TrendyolFinanceRecord, sign: 1 | -1) => {
    const pd = num(r.paymentDate);
    if (!pd || trDayStart(pd) < today || (r.paymentOrderId !== null && r.paymentOrderId !== undefined && r.paymentOrderId !== "")) return;
    const key = trDayStart(pd);
    const g = upcoming.get(key) ?? { amount: 0, orders: new Set<string>() };
    g.amount += sign * abs(r.sellerRevenue);
    if (r.orderNumber) g.orders.add(r.orderNumber);
    upcoming.set(key, g);
  };
  for (const r of finance.sales) add(r, 1);
  for (const r of finance.returns) add(r, -1);
  // Bilinen kargo bedelleri ödemeden düşülür.
  for (const g of upcoming.values()) {
    for (const on of g.orders) g.amount -= finance.cargoByOrder.get(on) ?? 0;
  }
  const groups = [...upcoming.entries()].sort((a, b) => a[0] - b[0]);
  const [first, ...rest] = groups;
  const next = first ? { date: first[0], amount: round2(first[1].amount), orders: first[1].orders.size } : null;
  let later: TrendyolInsights["payments"]["later"] = null;
  if (rest.length > 0) {
    const ords = new Set<string>();
    let amount = 0;
    for (const [, g] of rest) { amount += g.amount; for (const on of g.orders) ords.add(on); }
    later = { date: rest[0][0], amount: round2(amount), orders: ords.size };
  }

  // Henüz teslim edilmemiş siparişler (ekstrede yok): tutar − tahmini komisyon − ort. kargo.
  const settledNos = new Set(finance.sales.map(r => r.orderNumber).filter(Boolean) as string[]);
  const avgCargo = finance.cargoItemCount > 0 ? finance.cargoItemTotal / finance.cargoItemCount : 0;
  const nd = new Set<string>();
  let ndAmount = 0;
  for (const o of orders) {
    if (!NOT_DELIVERED_TABS.has(o.tab) || classifyOrder(o) !== "sale" || settledNos.has(o.orderNumber)) continue;
    const amount = packageAmount(o);
    let comm = 0;
    for (const s of lineShares(o, amount)) {
      const rate = s.commissionRate ?? fallbackRate;
      if (rate !== null) comm += (s.amount * rate) / 100;
    }
    ndAmount += amount - comm - avgCargo;
    nd.add(o.orderNumber);
  }

  // Geçmiş ödemeler (PaymentOrder) + ekstredeki paymentOrderId ile döküm.
  const byPayment = new Map<string, { sales: number; commission: number; orders: Set<string> }>();
  const addPaid = (r: TrendyolFinanceRecord, sign: 1 | -1) => {
    if (r.paymentOrderId === null || r.paymentOrderId === undefined || r.paymentOrderId === "") return;
    const key = String(r.paymentOrderId);
    const g = byPayment.get(key) ?? { sales: 0, commission: 0, orders: new Set<string>() };
    g.sales += sign * (sign === 1 ? abs(r.credit) : abs(r.debt));
    g.commission += sign * abs(r.commissionAmount);
    if (r.orderNumber) g.orders.add(r.orderNumber);
    byPayment.set(key, g);
  };
  for (const r of finance.sales) addPaid(r, 1);
  for (const r of finance.returns) addPaid(r, -1);

  const past = finance.payments
    .map(r => {
      const id = String(r.id ?? r.paymentOrderId ?? "");
      const amount = abs(r.debt) || abs(r.credit);
      const g = id ? byPayment.get(id) : undefined;
      // Döküm yalnız ekstrede bu ödemenin satışları (tutarı açıklayacak kadar) varsa.
      const usable = g && g.sales - g.commission >= amount * 0.98;
      return {
        id,
        date: num(r.transactionDate),
        amount: round2(amount),
        orders: g ? g.orders.size : null,
        sales: usable ? round2(g.sales) : null,
        commission: usable ? round2(g.commission) : null,
        deductions: usable ? round2(Math.max(0, g.sales - g.commission - amount)) : null,
      };
    })
    .filter(p => p.date > 0 && p.amount > 0)
    .sort((a, b) => b.date - a.date)
    .slice(0, PAST_PAYMENTS_LIMIT);

  return {
    available: finance.available,
    next,
    later,
    notDelivered: { amount: round2(Math.max(0, ndAmount)), orders: nd.size },
    past,
  };
}

// ── Ekstre okuma (önbellekli) ────────────────────────────────────────────────

export type InsightsDeps = {
  listOrders?: () => Promise<OrdersListResult>;
  fetchSettlements?: (p: GetFinanceParams) => Promise<TrendyolFinanceResponse>;
  fetchOtherFinancials?: (p: GetFinanceParams) => Promise<TrendyolFinanceResponse>;
  fetchCargoItems?: (serial: string, page?: number) => Promise<TrendyolCargoInvoiceResponse>;
  now?: number;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchRecords(
  fetcher: (p: GetFinanceParams) => Promise<TrendyolFinanceResponse>,
  transactionType: string,
  start: number,
  end: number,
): Promise<TrendyolFinanceRecord[]> {
  const windows: Array<[number, number]> = [];
  for (let s = start; s < end; s += FINANCE_CHUNK_MS) windows.push([s, Math.min(end, s + FINANCE_CHUNK_MS)]);
  const chunks = await mapLimit(windows, FINANCE_CONCURRENCY, async ([s, e]) => {
    const acc: TrendyolFinanceRecord[] = [];
    for (let page = 0; page < FINANCE_MAX_PAGES; page += 1) {
      const resp = await fetcher({ transactionType, startDate: s, endDate: e, page, size: 500 });
      const content = resp.content ?? [];
      acc.push(...content);
      if (page + 1 >= (resp.totalPages ?? 1) || content.length === 0) break;
    }
    return acc;
  });
  // Pencere sınırında tekrar gelen kayıtları ayıkla.
  const seen = new Set<string>();
  const out: TrendyolFinanceRecord[] = [];
  for (const r of chunks.flat()) {
    const key = `${r.id ?? ""}|${r.orderNumber ?? ""}|${r.barcode ?? ""}|${r.transactionDate ?? ""}|${r.credit ?? ""}|${r.debt ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// Kargo faturası kalemleri değişmez → seri numarasına göre süreç ömrü boyunca tutulur.
const cargoInvoiceCache = new Map<string, Array<{ orderNumber: string | null; amount: number }>>();

async function loadCargoItems(
  serial: string,
  fetcher: (serial: string, page?: number) => Promise<TrendyolCargoInvoiceResponse>,
  useCache: boolean,
): Promise<Array<{ orderNumber: string | null; amount: number }>> {
  const hit = useCache ? cargoInvoiceCache.get(serial) : undefined;
  if (hit) return hit;
  const items: Array<{ orderNumber: string | null; amount: number }> = [];
  for (let page = 0; page < FINANCE_MAX_PAGES; page += 1) {
    const resp = await fetcher(serial, page);
    const content = resp.content ?? [];
    for (const it of content) items.push({ orderNumber: it.orderNumber ? String(it.orderNumber) : null, amount: abs(it.amount) });
    if (page + 1 >= (resp.totalPages ?? 1) || content.length === 0) break;
  }
  if (useCache) cargoInvoiceCache.set(serial, items);
  return items;
}

export async function loadFinance(start: number, end: number, deps: InsightsDeps = {}): Promise<FinanceData> {
  const settlements = deps.fetchSettlements ?? defaultGetSettlements;
  const other = deps.fetchOtherFinancials ?? defaultGetOtherFinancials;
  const cargoItems = deps.fetchCargoItems ?? defaultGetCargoInvoiceItems;
  const useCache = !deps.fetchCargoItems;

  let sales: TrendyolFinanceRecord[];
  let returns: TrendyolFinanceRecord[];
  try {
    [sales, returns] = await Promise.all([
      fetchRecords(settlements, "Sale", start, end),
      fetchRecords(settlements, "Return", start, end),
    ]);
  } catch (err) {
    console.error("[trendyol-insights] ekstre (settlements) alınamadı:", err instanceof Error ? err.message : err);
    return { ...EMPTY_FINANCE, cargoByOrder: new Map() };
  }

  // Kesinti faturaları ve ödemeler: biri düşerse kalan veriyle devam.
  const [deductions, payments] = await Promise.all([
    fetchRecords(other, "DeductionInvoices", start, end).catch((err) => {
      console.error("[trendyol-insights] kesinti faturaları alınamadı:", err instanceof Error ? err.message : err);
      return [] as TrendyolFinanceRecord[];
    }),
    fetchRecords(other, "PaymentOrder", start, end).catch((err) => {
      console.error("[trendyol-insights] ödeme emirleri alınamadı:", err instanceof Error ? err.message : err);
      return [] as TrendyolFinanceRecord[];
    }),
  ]);

  const cargoByOrder = new Map<string, number>();
  let cargoItemCount = 0;
  let cargoItemTotal = 0;
  const serials = deductions.filter(isCargoInvoice).map(r => String(r.id ?? "")).filter(Boolean);
  const perInvoice = await mapLimit(serials, FINANCE_CONCURRENCY, serial =>
    loadCargoItems(serial, cargoItems, useCache).catch((err) => {
      console.error("[trendyol-insights] kargo faturası alınamadı:", serial, err instanceof Error ? err.message : err);
      return [] as Array<{ orderNumber: string | null; amount: number }>;
    }),
  );
  for (const items of perInvoice) {
    for (const it of items) {
      if (!it.orderNumber) continue;
      cargoByOrder.set(it.orderNumber, (cargoByOrder.get(it.orderNumber) ?? 0) + it.amount);
      cargoItemCount += 1;
      cargoItemTotal += it.amount;
    }
  }

  return { available: true, sales, returns, deductions, payments, cargoByOrder, cargoItemCount, cargoItemTotal };
}

type FinanceCacheEntry = { start: number; fetchedAt: number; data: FinanceData };
let financeCache: FinanceCacheEntry | null = null;
let financeInflight: { start: number; promise: Promise<FinanceData> } | null = null;

// Tüm dönemler aynı ekstre penceresini paylaşır: önceki ayın başı → şimdi.
async function getFinanceCached(now: number): Promise<FinanceData> {
  const { y, m } = trParts(now);
  const start = trMonthStart(y, m - 1);
  if (financeCache && financeCache.start === start && now - financeCache.fetchedAt < FINANCE_TTL_MS) {
    return financeCache.data;
  }
  if (financeInflight && financeInflight.start === start) return financeInflight.promise;
  const promise = loadFinance(start, now)
    .then((data) => {
      // Ekstre hiç gelmediyse kısa süre sonra yeniden denensin diye önbelleğe alma.
      if (data.available) financeCache = { start, fetchedAt: Date.now(), data };
      return data;
    })
    .finally(() => { financeInflight = null; });
  financeInflight = { start, promise };
  return promise;
}

export function clearInsightsCache(): void {
  financeCache = null;
  financeInflight = null;
  cargoInvoiceCache.clear();
}

export function parseInsightPeriod(raw: unknown): InsightPeriod {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === undefined || v === null || v === "") return "ay";
  if (typeof v === "string" && (INSIGHT_PERIODS as readonly string[]).includes(v)) return v as InsightPeriod;
  throw new ValidationError("Geçersiz dönem. Beklenen: hafta, ay, gecen.");
}

// GET /trendyol/insights akışı. Sipariş listesi flag kontrolünü (marketplaceSyncEnabled)
// listTrendyolOrders üzerinden devralır. Enjekte bağımlılıklar (smoke) önbelleği atlar.
export async function getTrendyolInsights(
  period: InsightPeriod,
  deps: InsightsDeps = {},
): Promise<TrendyolInsights> {
  const now = deps.now ?? Date.now();
  const injected = Boolean(deps.fetchSettlements || deps.fetchOtherFinancials || deps.fetchCargoItems);
  const listOrders = deps.listOrders ?? (() => listTrendyolOrders({ windowDays: ORDERS_WINDOW_DAYS }));

  const [list, finance] = await Promise.all([
    listOrders(),
    (async () => {
      if (injected) {
        const { y, m } = trParts(now);
        return loadFinance(trMonthStart(y, m - 1), now, deps);
      }
      return getFinanceCached(now);
    })(),
  ]);
  return buildTrendyolInsights({ period, now, orders: list.orders, finance });
}
