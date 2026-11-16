// Pazaryeri özeti — mobil Siparişler ekranının üstündeki kart şeridi + detayları.
//
// Trendyol (trendyol/insights.service) ve Hepsiburada (hepsiburada/insights.service)
// özetleri AYNI biçimde (ChannelInsights) üretilir; burada toplanır. Yanıt hem
// birleşik özeti hem kanal başına özeti (byChannel) taşır → ekrandaki kanal
// filtresi (Tümü / Trendyol / Hepsiburada) yeni istek atmadan özeti süzer.
//
// Bir kanal düşerse diğeriyle devam edilir (failed listesinde görünür); HB kimliği
// yoksa HB sessizce dışarıda kalır. İkisi de yoksa ilk hata fırlatılır
// (marketplace_sync kapalıysa 409). SALT-OKUMA.

import {
  PAST_PAYMENTS_LIMIT,
  TOP_PRODUCTS_LIMIT,
  getTrendyolInsights,
  round2,
  type ChannelInsights,
  type InsightPayment,
  type InsightPeriod,
  type InsightProduct,
  type InsightsDeps,
  type MarketplaceChannel,
} from "./trendyol/insights.service.js";
import { getHepsiburadaInsights, type HbInsightsDeps } from "./hepsiburada/insights.service.js";

export type InsightQueueItem = InsightPayment & { kind: "next" | "later"; channel: MarketplaceChannel | null };

// Ekrana giden özet: kanal özeti + ödeme sırası (queue) + ekstresi alınamayan kanallar.
export type ScopedInsights = Omit<ChannelInsights, "breakdown" | "payments"> & {
  breakdown: ChannelInsights["breakdown"] & { financeMissing: MarketplaceChannel[] };
  payments: ChannelInsights["payments"] & { queue: InsightQueueItem[] };
};

export type MarketplaceInsights = ScopedInsights & {
  channels: MarketplaceChannel[]; // birleşik özete giren kanallar
  failed: MarketplaceChannel[];   // verisi alınamayan kanallar
  byChannel: Partial<Record<MarketplaceChannel, ScopedInsights>>;
};

function topProducts(top: InsightProduct[], limit = TOP_PRODUCTS_LIMIT): InsightProduct[] {
  return [...top].sort((a, b) => b.quantity - a.quantity || b.total - a.total).slice(0, limit);
}

function queueOf(channel: MarketplaceChannel, p: ChannelInsights["payments"]): InsightQueueItem[] {
  const out: InsightQueueItem[] = [];
  if (p.next) out.push({ ...p.next, kind: "next", channel });
  if (p.later) out.push({ ...p.later, kind: "later", channel });
  return out;
}

// Tek kanal → ekran biçimi (ürün listesi ilk 20'ye kesilir).
export function scopeChannel(channel: MarketplaceChannel, d: ChannelInsights): ScopedInsights {
  return {
    ...d,
    products: { count: d.products.count, top: topProducts(d.products.top) },
    breakdown: { ...d.breakdown, financeMissing: d.breakdown.financeAvailable ? [] : [channel] },
    payments: { ...d.payments, queue: queueOf(channel, d.payments) },
  };
}

// Birden çok kanal → tek özet. Toplanabilenler toplanır; KDV ve "sana kalan"
// birleşik toplamlardan yeniden hesaplanır (KDV beyannamesi tek).
export function mergeChannelInsights(parts: Array<{ channel: MarketplaceChannel; data: ChannelInsights }>): ScopedInsights {
  if (parts.length === 0) throw new Error("mergeChannelInsights: en az bir kanal gerekir");
  if (parts.length === 1) return scopeChannel(parts[0].channel, parts[0].data);
  const ds = parts.map(p => p.data);
  const sum = (f: (d: ChannelInsights) => number) => ds.reduce((s, d) => s + f(d), 0);
  const first = ds[0];

  // ── Satış ──
  const total = sum(d => d.sales.total);
  const orders = sum(d => d.sales.orders);
  const prevKnown = ds.every(d => d.sales.prevTotal !== null);
  const prevTotal = prevKnown ? sum(d => d.sales.prevTotal ?? 0) : null;
  const daily = new Map<string, { total: number; orders: number }>();
  for (const d of ds) {
    for (const x of d.sales.daily) {
      const cur = daily.get(x.date) ?? { total: 0, orders: 0 };
      cur.total += x.total;
      cur.orders += x.orders;
      daily.set(x.date, cur);
    }
  }

  // ── Ürünler (aynı barkod iki kanalda satıldıysa birleşir) ──
  const products = new Map<string, InsightProduct>();
  for (const d of ds) {
    for (const p of d.products.top) {
      const cur = products.get(p.key);
      if (!cur) { products.set(p.key, { ...p }); continue; }
      cur.quantity += p.quantity;
      cur.total += p.total;
      if (!cur.imageUrl && p.imageUrl) cur.imageUrl = p.imageUrl;
    }
  }

  // ── Döküm ──
  const b = (f: (x: ChannelInsights["breakdown"]) => number) => sum(d => f(d.breakdown));
  const sales = b(x => x.sales);
  const commission = b(x => x.commission);
  const cargo = b(x => x.cargo);
  const otherFees = b(x => x.otherFees);
  const stoppage = b(x => x.stoppage);
  const vatSales = b(x => x.vat.sales);
  const vatDeductible = b(x => x.vat.deductible);
  const netVat = Math.max(0, vatSales - vatDeductible);
  const remaining = sales - commission - cargo - otherFees - stoppage - netVat;
  const weighted = (val: (x: ChannelInsights["breakdown"]) => number | null, weight: (x: ChannelInsights["breakdown"]) => number) => {
    let s = 0;
    let w = 0;
    for (const d of ds) {
      const v = val(d.breakdown);
      const wt = weight(d.breakdown);
      if (v === null || wt <= 0) continue;
      s += v * wt;
      w += wt;
    }
    return w > 0 ? round2(s / w) : null;
  };

  // ── Ödemeler ──
  const queue = parts.flatMap(p => queueOf(p.channel, p.data.payments)).sort((a, z) => a.date - z.date);
  const [head, ...tail] = queue;
  const next: InsightPayment | null = head ? { date: head.date, amount: head.amount, orders: head.orders, channel: head.channel } : null;
  let later: InsightPayment | null = null;
  if (tail.length > 0) {
    const chans = new Set(tail.map(q => q.channel));
    later = {
      date: tail[0].date,
      amount: round2(tail.reduce((s, q) => s + q.amount, 0)),
      orders: tail.reduce((s, q) => s + q.orders, 0),
      channel: chans.size === 1 ? tail[0].channel : null,
    };
  }

  return {
    period: first.period,
    range: first.range,
    generatedAt: first.generatedAt,
    sales: {
      total: round2(total),
      orders,
      packages: sum(d => d.sales.packages),
      units: sum(d => d.sales.units),
      avgOrder: orders > 0 ? round2(total / orders) : null,
      deltaPct: prevTotal !== null && prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null,
      prevTotal: prevTotal !== null ? round2(prevTotal) : null,
      daily: [...daily.entries()].sort((a, z) => (a[0] < z[0] ? -1 : 1)).map(([date, v]) => ({ date, total: round2(v.total), orders: v.orders })),
      cancelled: { orders: sum(d => d.sales.cancelled.orders), total: round2(sum(d => d.sales.cancelled.total)) },
      returned: { orders: sum(d => d.sales.returned.orders), total: round2(sum(d => d.sales.returned.total)) },
    },
    products: {
      count: products.size,
      top: topProducts([...products.values()]).map(p => ({ ...p, total: round2(p.total) })),
    },
    breakdown: {
      sales: round2(sales),
      commission: round2(commission),
      cargo: round2(cargo),
      otherFees: round2(otherFees),
      stoppage: round2(stoppage),
      vat: { sales: round2(vatSales), deductible: round2(vatDeductible), net: round2(netVat) },
      remaining: round2(remaining),
      remainingPct: sales > 0 ? Math.round((remaining / sales) * 100) : null,
      avgCommissionRate: weighted(x => x.avgCommissionRate, x => x.sales),
      cargoPackages: b(x => x.cargoPackages),
      avgCargo: weighted(x => x.avgCargo, x => x.cargoPackages),
      settledOrders: b(x => x.settledOrders),
      estimatedOrders: b(x => x.estimatedOrders),
      financeAvailable: ds.every(d => d.breakdown.financeAvailable),
      financeMissing: parts.filter(p => !p.data.breakdown.financeAvailable).map(p => p.channel),
    },
    payments: {
      available: ds.some(d => d.payments.available),
      next,
      later,
      notDelivered: {
        amount: round2(sum(d => d.payments.notDelivered.amount)),
        orders: sum(d => d.payments.notDelivered.orders),
      },
      past: parts
        .flatMap(p => p.data.payments.past.map(x => ({ ...x, channel: p.channel })))
        .sort((a, z) => z.date - a.date)
        .slice(0, PAST_PAYMENTS_LIMIT),
      queue,
    },
  };
}

export type MarketplaceInsightsDeps = {
  now?: number;
  trendyol?: InsightsDeps;
  hepsiburada?: HbInsightsDeps;
};

// GET /channels/insights akışı.
export async function getMarketplaceInsights(
  period: InsightPeriod,
  deps: MarketplaceInsightsDeps = {},
): Promise<MarketplaceInsights> {
  const now = deps.now ?? Date.now();
  const all = Number.POSITIVE_INFINITY; // birleşmeden önce ürünler kesilmesin
  const [ty, hb] = await Promise.allSettled([
    getTrendyolInsights(period, { ...deps.trendyol, now, topLimit: all }),
    getHepsiburadaInsights(period, { ...deps.hepsiburada, now, topLimit: all }),
  ]);

  const parts: Array<{ channel: MarketplaceChannel; data: ChannelInsights }> = [];
  const failed: MarketplaceChannel[] = [];
  if (ty.status === "fulfilled") parts.push({ channel: "trendyol", data: ty.value });
  else {
    failed.push("trendyol");
    console.error("[marketplace-insights] Trendyol özeti alınamadı:", ty.reason instanceof Error ? ty.reason.message : ty.reason);
  }
  if (hb.status === "fulfilled") {
    if (hb.value) parts.push({ channel: "hepsiburada", data: hb.value });
  } else {
    failed.push("hepsiburada");
    console.error("[marketplace-insights] Hepsiburada özeti alınamadı:", hb.reason instanceof Error ? hb.reason.message : hb.reason);
  }
  if (parts.length === 0) {
    throw ty.status === "rejected" ? ty.reason : hb.status === "rejected" ? hb.reason : new Error("Pazaryeri özeti alınamadı.");
  }

  const byChannel: MarketplaceInsights["byChannel"] = {};
  for (const p of parts) byChannel[p.channel] = scopeChannel(p.channel, p.data);
  return {
    ...mergeChannelInsights(parts),
    channels: parts.map(p => p.channel),
    failed,
    byChannel,
  };
}
