// Hepsiburada özeti — Trendyol özetiyle AYNI biçimde (ChannelInsights) üretilir ve
// Siparişler ekranının özet şeridinde Trendyol'la birleştirilir
// (services/marketplace-insights.service.ts).
//
// SALT-OKUMA. İki kaynak:
//   1. Sipariş görünümü (listHepsiburadaOrders, snapshot): satış, ürün, satır KDV ve
//      komisyon ORANLARI. HB'nin kargoda/teslim listeleri tarih aralığı ne olursa
//      olsun yalnız SON ~30 GÜNÜ döndürür → daha eski teslim edilmiş paketler
//      görünümde yoktur.
//   2. Muhasebe kayıtları (client getFinanceTransactions, ≤1 aylık pencereler):
//      sipariş başına Payment (satış), Commission, ShipmentCostSharingExpense
//      (kargo katılım payı), ProcessingFeeExpense + PaymentServiceCostReflection
//      (diğer kesintiler), Stoppage; iadede Return + …Refund kayıtları; hesaba yatan
//      ödeme TotalPayment. Görünümde olmayan (eski) teslim edilmiş siparişler
//      Payment kayıtlarından türetilir → "Geçen ay" da tam çıkar.
//
// Kayıtlar TESLİMDEN sonra oluşur (komisyon/kargo faturası birkaç gün sonra) →
// kaydı olmayan siparişin komisyonu satırdaki orandan tahmin edilir (HB oranı KDV
// hariçtir, faturaya %20 KDV eklenir: 349 × %22 × 1,2 = 92,14), kargosu ve diğer
// kesintileri bilinen siparişlerin ortalamasından.
//
// Ödeme günü: HB her SALI öder. Vadesi (dueDate) gelmiş kayıtların toplamı pozitifse
// o salı hesaba yatar; değilse (ör. komisyon faturası satıştan önce vadeye girdiyse)
// sonraki salıya devreder. Canlı veriyle doğrulandı (2026-09 → 2026-11).
//
// Hiçbir şey yazılmaz; muhasebe okuması 10 dk süreç-içi önbellekte tutulur.

import {
  getFinanceTransactions as defaultGetFinanceTransactions,
  isHepsiburadaConfigured,
  type HepsiburadaFinanceTransaction,
  type HepsiburadaTransactionsQuery,
  type HepsiburadaTransactionsResponse,
} from "./client.js";
import { hbDate, listHepsiburadaOrders, type HbOrdersListResult } from "./orders.service.js";
import type { DisplayLine, DisplayOrder, OrdersListResult } from "../trendyol/orders.service.js";
import {
  DAY,
  NOT_DELIVERED_TABS,
  PAST_PAYMENTS_LIMIT,
  SALE_TABS,
  SERVICE_VAT_RATE,
  STOPPAGE_RATE,
  TOP_PRODUCTS_LIMIT,
  inRange,
  lineShares,
  mapLimit,
  num,
  packageAmount,
  periodRange,
  round2,
  trDayKey,
  trDayStart,
  trMonthStart,
  trParts,
  type ChannelInsights,
  type InsightPastPayment,
  type InsightPayment,
  type InsightPeriod,
  type InsightProduct,
  type LineShare,
} from "../trendyol/insights.service.js";

const PAYOUT_WEEKDAY = 2;          // Salı (0 = Pazar)
const VIEW_COVERAGE_DAYS = 30;     // HB paket listeleri yalnız son ~30 günü verir
const FINANCE_TTL_MS = 10 * 60_000;
const FINANCE_WINDOW_DAYS = 27;    // HB: RecordDate aralığı en fazla 1 ay
const FINANCE_PAGE = 100;          // HB: Limit ≤ 100
const FINANCE_MAX_PAGES = 30;
const FINANCE_CONCURRENCY = 3;
const COMMISSION_VAT_FACTOR = 1 + SERVICE_VAT_RATE / 100;

// ── Muhasebe kaydı (normalize) ───────────────────────────────────────────────

export type HbFinanceRecord = {
  id: string;
  type: string;            // HB transactionType
  status: string;          // "Paid" | "WillBePaid"
  orderNumber: string | null;
  packageNumber: string | null;
  sku: string | null;      // HB SKU (HBCV…)
  productName: string | null;
  quantity: number;
  amount: number;          // işaretli, KDV dahil: + satıcıya, − satıcıdan
  orderDate: number | null;
  invoiceDate: number | null;
  dueDate: number | null;
  paymentDate: number | null;
  invoiceNumber: string | null;
};

export type HbFinanceData = {
  available: boolean;
  coverageStart: number | null; // kayıt penceresinin başı (karşılaştırma bu tarihten sonrası için)
  records: HbFinanceRecord[];
};

export const EMPTY_HB_FINANCE: HbFinanceData = { available: false, coverageStart: null, records: [] };

const text = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v);
  return t === "" ? null : t;
};

// HB muhasebe tarihleri saat dilimsiz İstanbul günüdür; "1900-01-01" / "0001-…" boştur.
export function hbFinanceDate(raw: string | null | undefined): number | null {
  if (!raw || Number(raw.slice(0, 4)) < 2000) return null;
  return hbDate(raw);
}

export function normalizeHbRecord(r: HepsiburadaFinanceTransaction): HbFinanceRecord {
  const amount = num(r.amount?.value);
  return {
    id: text(r.id) ?? [r.transactionType, r.orderNumber, r.invoiceNumber, r.orderItemNumber, amount].join("|"),
    type: text(r.transactionType) ?? "",
    status: text(r.status) ?? "",
    orderNumber: text(r.orderNumber),
    packageNumber: text(r.packageNumber),
    sku: text(r.sku),
    productName: text(r.productName),
    quantity: typeof r.quantity === "number" && r.quantity > 0 ? r.quantity : 1,
    amount,
    orderDate: hbFinanceDate(r.orderDate),
    invoiceDate: hbFinanceDate(r.invoiceDate),
    dueDate: hbFinanceDate(r.dueDate),
    paymentDate: hbFinanceDate(r.paymentDate),
    invoiceNumber: text(r.invoiceNumber),
  };
}

type RecordKind = "sale" | "return" | "commission" | "cargo" | "stoppage" | "payout" | "fee";

export function hbRecordKind(type: string): RecordKind {
  if (type === "Payment") return "sale";
  if (type === "Return") return "return";
  if (type === "TotalPayment") return "payout";
  if (/^Commission/i.test(type)) return "commission";
  if (/^Stoppage/i.test(type)) return "stoppage";
  if (/shipment|cargo|kargo/i.test(type)) return "cargo";
  return "fee"; // ProcessingFeeExpense, PaymentServiceCostReflection(+Refund), EInvoiceSales…
}

// ── Sipariş başı muhasebe özeti ──────────────────────────────────────────────

type OrderFinance = {
  sale: number;       // Σ Payment (KDV dahil)
  returned: number;   // Σ |Return|
  commission: number; // net maliyet (iade düşülmüş), KDV dahil
  cargo: number;
  fees: number;       // işlem bedeli + ödeme hizmet bedeli vb.
  hasSale: boolean;
  hasCommission: boolean;
  hasCargo: boolean;
  hasFees: boolean;
  orderDate: number | null;
  saleLines: Array<{ sku: string | null; name: string | null; quantity: number; amount: number }>;
};

function orderFinanceMap(records: HbFinanceRecord[]): Map<string, OrderFinance> {
  const map = new Map<string, OrderFinance>();
  for (const r of records) {
    if (!r.orderNumber) continue;
    const kind = hbRecordKind(r.type);
    if (kind === "payout" || kind === "stoppage") continue; // stopaj aşağıda hesaplanır
    const f = map.get(r.orderNumber) ?? {
      sale: 0, returned: 0, commission: 0, cargo: 0, fees: 0,
      hasSale: false, hasCommission: false, hasCargo: false, hasFees: false,
      orderDate: null, saleLines: [],
    };
    f.orderDate = f.orderDate ?? r.orderDate;
    const cost = -r.amount; // gider pozitif, iade (refund) negatif
    if (kind === "sale") {
      f.sale += r.amount;
      f.hasSale = true;
      f.saleLines.push({ sku: r.sku, name: r.productName, quantity: r.quantity, amount: r.amount });
    } else if (kind === "return") {
      f.returned += Math.abs(r.amount);
    } else if (kind === "commission") {
      f.commission += cost;
      f.hasCommission = true;
    } else if (kind === "cargo") {
      f.cargo += cost;
      f.hasCargo = true;
    } else {
      f.fees += cost;
      f.hasFees = true;
    }
    map.set(r.orderNumber, f);
  }
  return map;
}

// HB SKU → görünümdeki satırın barkodu/fotoğrafı/oranları. Muhasebe kaydında
// yalnız HB SKU ve ürün adı var; görünümden türetilen eşleşme sayesinde eski
// siparişler aynı ürün anahtarına (barkod) ve fotoğrafa düşer.
type SkuInfo = Pick<DisplayLine, "barcode" | "imageUrl" | "internalName" | "internalProductId" | "commissionRate" | "vatRate" | "productName">;

function skuInfoMap(view: DisplayOrder[], fin: Map<string, OrderFinance>): Map<string, SkuInfo> {
  const out = new Map<string, SkuInfo>();
  const norm = (s: string | null) => (s ?? "").trim().toLocaleLowerCase("tr-TR");
  for (const o of view) {
    const f = fin.get(o.orderNumber);
    if (!f || f.saleLines.length === 0) continue;
    const skus = [...new Set(f.saleLines.map(l => l.sku).filter((s): s is string => !!s))];
    for (const sku of skus) {
      if (out.has(sku)) continue;
      const name = norm(f.saleLines.find(l => l.sku === sku)?.name ?? null);
      const line = o.lines.length === 1 && skus.length === 1
        ? o.lines[0]
        : o.lines.find(l => name !== "" && norm(l.productName) === name);
      if (!line) continue;
      out.set(sku, {
        barcode: line.barcode,
        imageUrl: line.imageUrl,
        internalName: line.internalName,
        internalProductId: line.internalProductId,
        commissionRate: line.commissionRate,
        vatRate: line.vatRate,
        productName: line.productName,
      });
    }
  }
  return out;
}

// Görünümde olmayan (HB listesinin 30 gününden eski) teslim edilmiş siparişleri
// Payment kayıtlarından türetir.
function ordersFromFinance(fin: Map<string, OrderFinance>, known: Set<string>, skus: Map<string, SkuInfo>): DisplayOrder[] {
  const out: DisplayOrder[] = [];
  for (const [orderNumber, f] of fin) {
    if (known.has(orderNumber) || !f.hasSale || f.sale <= 0 || f.orderDate === null) continue;
    const lines: DisplayLine[] = f.saleLines.map((l, i) => {
      const info = l.sku ? skus.get(l.sku) : undefined;
      return {
        lineId: `${orderNumber}-fin-${i}`,
        barcode: info?.barcode ?? null,
        quantity: l.quantity,
        productName: info?.productName ?? l.name,
        merchantSku: null,
        color: null,
        size: null,
        unitPrice: l.quantity > 0 ? l.amount / l.quantity : l.amount,
        commissionRate: info?.commissionRate ?? null,
        vatRate: info?.vatRate ?? null,
        matched: !!info?.internalProductId,
        internalProductId: info?.internalProductId ?? null,
        internalName: info?.internalName ?? null,
        imageUrl: info?.imageUrl ?? null,
        channelTitle: l.name,
        productUrl: null,
      };
    });
    out.push({
      id: `hb:${orderNumber}::muhasebe`,
      channel: "hepsiburada",
      orderNumber,
      packageId: null,
      status: "Delivered",
      tab: "teslim",
      orderDate: f.orderDate,
      agreedDeliveryDate: null,
      lastModifiedDate: null,
      buyerName: null,
      city: null,
      district: null,
      cargoProvider: null,
      cargoTrackingNumber: null,
      cargoTrackingLink: null,
      saleAmount: round2(f.sale),
      discount: 0,
      billable: round2(f.sale),
      invoiced: true,
      lines,
    });
  }
  return out;
}

type OrderClass = "sale" | "cancelled" | "returned" | "skip";

function classify(o: DisplayOrder, f: OrderFinance | undefined): OrderClass {
  if (o.tab === "diger") return "cancelled"; // HB'de "diğer" yalnız iptal listesinden gelir
  if (f && f.sale > 0 && f.returned >= f.sale - 0.01) return "returned";
  return SALE_TABS.has(o.tab) ? "sale" : "skip";
}

// Kısmi iadede satış tutarı iade oranında düşer.
function saleAmountOf(o: DisplayOrder, f: OrderFinance | undefined): number {
  const amount = packageAmount(o);
  if (!f || f.sale <= 0 || f.returned <= 0) return amount;
  return amount * Math.max(0, 1 - f.returned / f.sale);
}

function salesTotal(orders: DisplayOrder[], fin: Map<string, OrderFinance>, start: number, end: number): number {
  let total = 0;
  for (const o of orders) {
    if (!inRange(o.orderDate, start, end)) continue;
    const f = fin.get(o.orderNumber);
    if (classify(o, f) === "sale") total += saleAmountOf(o, f);
  }
  return total;
}

function estimateCommission(shares: LineShare[], fallbackRate: number | null): number {
  let c = 0;
  for (const s of shares) {
    const rate = s.commissionRate ?? fallbackRate;
    if (rate !== null) c += ((s.amount * rate) / 100) * COMMISSION_VAT_FACTOR;
  }
  return c;
}

// Bugünden (ya da vadeden) sonraki ilk salı (İstanbul günü 00:00).
export function nextPayoutDay(ms: number): number {
  const d = trDayStart(ms);
  const dow = trParts(d).dow;
  return d + ((PAYOUT_WEEKDAY - dow + 7) % 7) * DAY;
}

// ── Saf çekirdek ─────────────────────────────────────────────────────────────

export function buildHepsiburadaInsights(input: {
  period: InsightPeriod;
  now: number;
  orders: DisplayOrder[];
  finance: HbFinanceData;
  topLimit?: number;
}): ChannelInsights {
  const { period, now, finance } = input;
  const topLimit = input.topLimit ?? TOP_PRODUCTS_LIMIT;
  const range = periodRange(period, now);
  const { start, end } = range;

  const fin = orderFinanceMap(finance.records);
  const view = input.orders.filter(o => o.channel === "hepsiburada");
  const known = new Set(view.map(o => o.orderNumber));
  const orders = [...view, ...ordersFromFinance(fin, known, skuInfoMap(view, fin))];

  // Kesinleşmiş kayıtlardan ortalamalar (kaydı olmayan siparişlerin tahmini için).
  // İadeli siparişler dışarıda: dönüş kargosu ve tekrar kesilen bedeller ortalamayı şişirir.
  let commSum = 0;
  let commBase = 0;
  let cargoSum = 0;
  let cargoN = 0;
  let feeSum = 0;
  let feeN = 0;
  for (const f of fin.values()) {
    if (f.sale <= 0 || f.returned > 0) continue;
    if (f.hasCommission) { commSum += f.commission; commBase += f.sale; }
    if (f.hasCargo) { cargoSum += f.cargo; cargoN += 1; }
    if (f.hasFees) { feeSum += f.fees; feeN += 1; }
  }
  const avgCargo = cargoN > 0 ? cargoSum / cargoN : null;
  const avgFees = feeN > 0 ? feeSum / feeN : null;
  // Muhasebeden türetilen oran KDV hariçtir (satır oranlarıyla aynı ölçek).
  const ledgerRate = commBase > 0 ? (commSum / commBase / COMMISSION_VAT_FACTOR) * 100 : null;

  let total = 0;
  let units = 0;
  let packages = 0;
  let salesVat = 0;
  let commission = 0;
  let cargo = 0;
  let fees = 0;
  let cargoPackages = 0;
  let lineRateSum = 0;
  let lineRateWeight = 0;
  const orderNumbers = new Set<string>();
  const settledOrders = new Set<string>();
  const estimatedOrders = new Set<string>();
  const commissionCounted = new Set<string>();
  const cargoCounted = new Set<string>();
  const feesCounted = new Set<string>();
  const cancelled = new Set<string>();
  const returned = new Set<string>();
  let cancelledTotal = 0;
  let returnedTotal = 0;
  const daily = new Map<string, { total: number; orders: Set<string> }>();
  const products = new Map<string, InsightProduct>();
  const pending: LineShare[][] = [];

  for (let d = trDayStart(start); d < end; d += DAY) {
    daily.set(trDayKey(d), { total: 0, orders: new Set() });
  }

  for (const o of orders) {
    if (!inRange(o.orderDate, start, end)) continue;
    const f = fin.get(o.orderNumber);
    const cls = classify(o, f);
    if (cls === "cancelled") { cancelled.add(o.orderNumber); cancelledTotal += packageAmount(o); continue; }
    if (cls === "returned") { returned.add(o.orderNumber); returnedTotal += packageAmount(o); continue; }
    if (cls !== "sale") continue;
    const amount = saleAmountOf(o, f);

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

    // Komisyon / kargo / diğer: kayıt varsa kesin (sipariş başına bir kez), yoksa tahmin.
    if (f?.hasCommission) {
      if (!commissionCounted.has(o.orderNumber)) commission += Math.max(0, f.commission);
      commissionCounted.add(o.orderNumber);
    } else {
      pending.push(shares);
    }
    if (f?.hasCargo) {
      if (!cargoCounted.has(o.orderNumber)) cargo += Math.max(0, f.cargo);
      cargoCounted.add(o.orderNumber);
    } else if (avgCargo !== null) {
      cargo += avgCargo;
    }
    if (f?.hasFees) {
      if (!feesCounted.has(o.orderNumber)) fees += Math.max(0, f.fees);
      feesCounted.add(o.orderNumber);
    } else if (avgFees !== null) {
      fees += avgFees;
    }
    cargoPackages += 1;
    if (f?.hasCommission && f.hasCargo) settledOrders.add(o.orderNumber);
    else estimatedOrders.add(o.orderNumber);
  }

  const lineRate = lineRateWeight > 0 ? lineRateSum / lineRateWeight : null;
  const fallbackRate = lineRate ?? ledgerRate;
  for (const shares of pending) commission += estimateCommission(shares, fallbackRate);

  // Siparişe bağlı olmayan HB faturaları (ör. e-fatura hizmet bedeli): dönemde kesilenler.
  let unlinked = 0;
  for (const r of finance.records) {
    if (r.orderNumber) continue;
    const kind = hbRecordKind(r.type);
    if (kind === "payout" || kind === "sale" || kind === "stoppage") continue;
    if (inRange(r.invoiceDate ?? r.dueDate, start, end)) unlinked += -r.amount;
  }
  const otherFees = Math.max(0, fees + unlinked);

  const stoppage = Math.max(0, (total - salesVat) * STOPPAGE_RATE);
  const vatDeductible = ((commission + cargo + otherFees) * SERVICE_VAT_RATE) / (100 + SERVICE_VAT_RATE);
  const netVat = Math.max(0, salesVat - vatDeductible);
  const remaining = total - commission - cargo - otherFees - stoppage - netVat;

  // Karşılaştırma: muhasebe penceresi (yoksa HB listesinin 30 günü) kapsıyorsa.
  const coverageStart = finance.available && finance.coverageStart !== null
    ? Math.min(finance.coverageStart, now - (VIEW_COVERAGE_DAYS - 1) * DAY)
    : now - (VIEW_COVERAGE_DAYS - 1) * DAY;
  let deltaPct: number | null = null;
  let prevTotal: number | null = null;
  if (range.prevStart >= coverageStart) {
    const prev = salesTotal(orders, fin, range.prevStart, range.prevEnd);
    prevTotal = round2(prev);
    if (prev > 0) deltaPct = Math.round(((total - prev) / prev) * 100);
  }

  const top = [...products.values()]
    .sort((a, b) => b.quantity - a.quantity || b.total - a.total)
    .slice(0, topLimit)
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
      prevTotal,
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
      commissionVatAdded: true,
      cargoPackages,
      avgCargo: avgCargo !== null ? round2(avgCargo) : null,
      settledOrders: settledOrders.size,
      estimatedOrders: estimatedOrders.size,
      financeAvailable: finance.available,
    },
    payments: buildPayments({ orders, fin, finance, now, fallbackRate, avgCargo, avgFees }),
  };
}

function buildPayments(input: {
  orders: DisplayOrder[];
  fin: Map<string, OrderFinance>;
  finance: HbFinanceData;
  now: number;
  fallbackRate: number | null;
  avgCargo: number | null;
  avgFees: number | null;
}): ChannelInsights["payments"] {
  const { orders, fin, finance, now, fallbackRate, avgCargo, avgFees } = input;
  const today = trDayStart(now);

  // Ödenecek kayıtlar → vadesinden (geçmişse bugünden) sonraki ilk salı. Bir salının
  // toplamı pozitif değilse HB ödemez; bakiye sonraki salıya devreder.
  const byDay = new Map<number, { amount: number; orders: Set<string> }>();
  for (const r of finance.records) {
    if (r.status.toLowerCase() !== "willbepaid" || hbRecordKind(r.type) === "payout") continue;
    const day = nextPayoutDay(Math.max(r.dueDate ?? today, today));
    const g = byDay.get(day) ?? { amount: 0, orders: new Set<string>() };
    g.amount += r.amount;
    if (r.orderNumber && hbRecordKind(r.type) === "sale") g.orders.add(r.orderNumber);
    byDay.set(day, g);
  }
  const payouts: Array<{ date: number; amount: number; orders: Set<string> }> = [];
  let carry = 0;
  let carryOrders = new Set<string>();
  for (const [date, g] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const amount = carry + g.amount;
    const ords = new Set([...carryOrders, ...g.orders]);
    if (amount > 0.005) {
      payouts.push({ date, amount, orders: ords });
      carry = 0;
      carryOrders = new Set();
    } else {
      carry = amount;
      carryOrders = ords;
    }
  }
  const [first, ...rest] = payouts;
  const next: InsightPayment | null = first
    ? { date: first.date, amount: round2(first.amount), orders: first.orders.size, channel: "hepsiburada" }
    : null;
  let later: InsightPayment | null = null;
  if (rest.length > 0) {
    const ords = new Set<string>();
    let amount = 0;
    for (const p of rest) { amount += p.amount; for (const on of p.orders) ords.add(on); }
    later = { date: rest[0].date, amount: round2(amount), orders: ords.size, channel: "hepsiburada" };
  }

  // Henüz ödemeye yansımamış (muhasebede satış kaydı olmayan) siparişler:
  // tutar − tahmini komisyon − ort. kargo − ort. diğer kesinti − stopaj.
  const nd = new Set<string>();
  let ndAmount = 0;
  for (const o of orders) {
    const f = fin.get(o.orderNumber);
    if (f?.hasSale || classify(o, f) !== "sale") continue;
    if (!NOT_DELIVERED_TABS.has(o.tab) && o.tab !== "teslim") continue;
    const amount = packageAmount(o);
    const shares = lineShares(o, amount);
    const vat = shares.reduce((s, x) => s + (x.amount * x.vatRate) / (100 + x.vatRate), 0);
    ndAmount += amount - estimateCommission(shares, fallbackRate) - (avgCargo ?? 0) - (avgFees ?? 0) - (amount - vat) * STOPPAGE_RATE;
    nd.add(o.orderNumber);
  }

  // Hesaba yatanlar (TotalPayment) + aynı gün ödenen kayıtlardan döküm.
  const paidBy = new Map<number, { all: number; sales: number; commission: number; orders: Set<string> }>();
  for (const r of finance.records) {
    const kind = hbRecordKind(r.type);
    if (r.status.toLowerCase() !== "paid" || kind === "payout" || r.paymentDate === null) continue;
    const key = trDayStart(r.paymentDate);
    const g = paidBy.get(key) ?? { all: 0, sales: 0, commission: 0, orders: new Set<string>() };
    g.all += r.amount;
    if (kind === "sale") g.sales += r.amount;
    if (kind === "return") g.sales -= Math.abs(r.amount);
    if (kind === "commission") g.commission += -r.amount;
    if (r.orderNumber) g.orders.add(r.orderNumber);
    paidBy.set(key, g);
  }
  const past: InsightPastPayment[] = finance.records
    .filter(r => hbRecordKind(r.type) === "payout")
    .map(r => {
      const date = r.paymentDate ?? r.invoiceDate ?? 0;
      const amount = Math.abs(r.amount);
      const g = date ? paidBy.get(trDayStart(date)) : undefined;
      // Döküm yalnız o günün kayıtları ödemeyi açıklıyorsa (pencere dışında kalan yoksa).
      const usable = !!g && Math.abs(g.all - amount) <= Math.max(1, amount * 0.02);
      return {
        id: r.invoiceNumber ?? r.id,
        date,
        amount: round2(amount),
        orders: g && g.orders.size > 0 ? g.orders.size : null,
        sales: usable ? round2(g.sales) : null,
        commission: usable ? round2(g.commission) : null,
        deductions: usable ? round2(Math.max(0, g.sales - g.commission - amount)) : null,
        channel: "hepsiburada" as const,
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

// ── Muhasebe okuma (önbellekli) ──────────────────────────────────────────────

export type HbInsightsDeps = {
  listOrders?: () => Promise<OrdersListResult & { configured?: boolean }>;
  fetchTransactions?: (q: HepsiburadaTransactionsQuery) => Promise<HepsiburadaTransactionsResponse>;
  now?: number;
  topLimit?: number;
};

const defaultFetchTransactions = async (q: HepsiburadaTransactionsQuery) => (await defaultGetFinanceTransactions(q)).data ?? {};

export async function loadHbFinance(
  start: number,
  end: number,
  fetcher: (q: HepsiburadaTransactionsQuery) => Promise<HepsiburadaTransactionsResponse> = defaultFetchTransactions,
): Promise<HbFinanceData> {
  // Gün aralıkları uçları dahil; pencereler bir gün örtüşür, kayıtlar id ile tekilleşir.
  const windows: Array<[string, string]> = [];
  for (let s = trDayStart(start); s <= end; s += FINANCE_WINDOW_DAYS * DAY) {
    windows.push([trDayKey(s), trDayKey(Math.min(end, s + FINANCE_WINDOW_DAYS * DAY))]);
  }
  try {
    const chunks = await mapLimit(windows, FINANCE_CONCURRENCY, async ([from, to]) => {
      const acc: HepsiburadaFinanceTransaction[] = [];
      for (let page = 0; page < FINANCE_MAX_PAGES; page += 1) {
        const resp = await fetcher({ recordDateStart: from, recordDateEnd: to, offset: acc.length, limit: FINANCE_PAGE });
        const items = resp.items ?? [];
        acc.push(...items);
        if (items.length < FINANCE_PAGE) break;
      }
      return acc;
    });
    const seen = new Set<string>();
    const records: HbFinanceRecord[] = [];
    for (const raw of chunks.flat()) {
      const r = normalizeHbRecord(raw);
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      records.push(r);
    }
    return { available: true, coverageStart: trDayStart(start), records };
  } catch (err) {
    console.error("[hb-insights] muhasebe kayıtları alınamadı:", err instanceof Error ? err.message : err);
    return { ...EMPTY_HB_FINANCE };
  }
}

// Muhasebe penceresi: iki ay önceki ayın başı → şimdi. Böylece "Geçen ay"ın
// karşılaştırması (önceki ay) da kapsanır.
function financeStart(now: number): number {
  const { y, m } = trParts(now);
  return trMonthStart(y, m - 2);
}

type FinanceCacheEntry = { start: number; fetchedAt: number; data: HbFinanceData };
let financeCache: FinanceCacheEntry | null = null;
let financeInflight: { start: number; promise: Promise<HbFinanceData> } | null = null;

async function getFinanceCached(now: number): Promise<HbFinanceData> {
  const start = financeStart(now);
  if (financeCache && financeCache.start === start && now - financeCache.fetchedAt < FINANCE_TTL_MS) {
    return financeCache.data;
  }
  if (financeInflight && financeInflight.start === start) return financeInflight.promise;
  const promise = loadHbFinance(start, now)
    .then((data) => {
      if (data.available) financeCache = { start, fetchedAt: Date.now(), data };
      return data;
    })
    .finally(() => { financeInflight = null; });
  financeInflight = { start, promise };
  return promise;
}

export function clearHbInsightsCache(): void {
  financeCache = null;
  financeInflight = null;
}

// Hepsiburada özeti. HB kimliği yoksa null (ekran yalnız Trendyol'la çalışır).
// Sipariş listesi flag kontrolünü (marketplaceSyncEnabled) listHepsiburadaOrders
// üzerinden devralır. Enjekte bağımlılıklar (smoke) önbelleği atlar.
export async function getHepsiburadaInsights(
  period: InsightPeriod,
  deps: HbInsightsDeps = {},
): Promise<ChannelInsights | null> {
  const now = deps.now ?? Date.now();
  const listOrders: () => Promise<OrdersListResult & { configured?: boolean }> =
    deps.listOrders ?? ((): Promise<HbOrdersListResult> => listHepsiburadaOrders({ windowDays: 90 }));
  const injected = Boolean(deps.fetchTransactions);
  if (!injected && !deps.listOrders && !isHepsiburadaConfigured()) {
    await listOrders(); // flag kapalıysa MarketplaceSyncDisabledError fırlatsın
    return null;
  }
  const [list, finance] = await Promise.all([
    listOrders(),
    injected ? loadHbFinance(financeStart(now), now, deps.fetchTransactions) : getFinanceCached(now),
  ]);
  if (list.configured === false) return null;
  return buildHepsiburadaInsights({ period, now, orders: list.orders, finance, topLimit: deps.topLimit });
}
