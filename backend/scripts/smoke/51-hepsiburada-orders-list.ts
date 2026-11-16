/**
 * SMOKE 51 — Hepsiburada sipariş görünümü (salt-okuma liste)
 *
 * Ağ YOK: gerçek Hepsiburada'ya çıkmaz. listHepsiburadaOrders'a sahte bir kaynak
 * enjekte edilir; iç ürün eşleşmesi (channel_listings, channel='hepsiburada',
 * anahtar merchantSku) ve "yeni sipariş" görülme kaydı (channel_order_sightings)
 * gerçek DB ile test edilir. Saf fonksiyonlar (hbDate, collectPackages,
 * buildHepsiburadaOrders, enrichmentNeeds) ayrıca izole test edilir.
 *
 * Senaryo:
 *   1. hbDate: saat dilimsiz HB tarihi İstanbul saati sayılır; "0001-…" boş.
 *   2. collectPackages: aynı paket birden çok listede → teslim > (kargoda/teslim
 *      edilemedi: yeni olan) > kargoya hazır.
 *   3. buildHepsiburadaOrders: kargoya hazır paket (tam veri) + kargodaki paket
 *      (detaydan, paket no'ya göre süzülmüş kalemler) + iptal (pencere süzgeci) +
 *      paketlenmemiş sipariş; sekmeler, tutarlar, barkod, takip linki, foto.
 *   4. enrichmentNeeds: yalnız ince kayıtlar için detay/kargo; teslim = kalıcı.
 *   5. Flag KAPALI → MARKETPLACE_SYNC_DISABLED.
 *   6. Sahte kaynakla liste: merchantSku eşleşmesi + sightings kaydı (hepsiburada).
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/51-hepsiburada-orders-list.ts
 */

import { createProduct } from "../../src/services/products.service.js";
import { createChannelListing } from "../../src/services/channel-listings.service.js";
import {
  buildHepsiburadaOrders,
  collectPackages,
  enrichmentNeeds,
  hbDate,
  listHepsiburadaOrders,
  type HbOrderSource,
  type HbRawOrders,
} from "../../src/services/hepsiburada/orders.service.js";
import type { HepsiburadaOrderDetail, HepsiburadaPackage } from "../../src/services/hepsiburada/client.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual,
  assertRejects, closePool, ok, getActorUserId,
} from "./_shared.js";

const TRY = (amount: number) => ({ currency: "TRY", amount });

function packedPackage(orderNumber: string, packageNumber: string, merchantSku: string): HepsiburadaPackage {
  return {
    packageNumber,
    barcode: `62${packageNumber}7`,
    status: "Open",
    cargoCompany: "Yurtiçi Kargo",
    orderDate: "2026-11-16T14:56:30.4",
    dueDate: "2026-11-17T14:56:30.388",
    recipientName: "Ada K.",
    shippingCity: "İzmir",
    shippingTown: "Torbalı",
    shippingDistrict: "Ayrancılar",
    isCargoChangable: true,
    items: [
      {
        lineItemId: "line-1",
        orderNumber,
        orderDate: "2026-11-16T14:56:30.4",
        hbSku: "HBV1",
        merchantSku,
        productName: "Buhurdanlık",
        quantity: 2,
        price: TRY(275),
        totalPrice: TRY(550),
        totalMerchantDiscount: TRY(50),
        commissionRate: 22,
        vatRate: 20,
        productImageUrlFormat: "https://productimages.hepsiburada.net/s/1/{size}/1.jpg",
        properties: [{ name: "Renk", value: "Kırmızı" }],
      },
    ],
  };
}

function detail(orderNumber: string, packages: Array<{ packageNumber: string; sku: string; status: string }>): HepsiburadaOrderDetail {
  return {
    orderNumber,
    orderDate: "2026-11-14T10:11:59",
    customer: { name: "Nil T." },
    deliveryAddress: { name: "Nil T.", city: "Denizli", town: "Pamukkale", district: "Mahalle" },
    items: packages.map((p, i) => ({
      id: `${orderNumber}-item-${i}`,
      orderNumber,
      orderDate: "2026-11-14T10:11:59",
      dueDate: "2026-11-16T18:30:00",
      lastStatusUpdateDate: "2026-11-16T15:17:15.199",
      name: `Ürün ${i}`,
      merchantSKU: p.sku,
      quantity: 1,
      unitPrice: TRY(349),
      totalPrice: TRY(349),
      merchantDiscount: { totalPrice: TRY(0) },
      status: p.status,
      cargoCompany: "PTT Kargo",
      packageNumber: p.packageNumber,
      barcode: `62${p.packageNumber}`,
      hasInvoice: false,
      productImageUrlFormat: "https://productimages.hepsiburada.net/s/777/{size}/2.jpg",
    })),
  };
}

async function run(): Promise<void> {
  const productIds: string[] = [];
  const stamp = Date.now().toString();
  const SKU = `SMOKE51_${stamp}`;
  const orderNumbers: string[] = [];

  const before = await getSettings();
  const originalFlag = before.marketplaceSyncEnabled;

  try {
    section("SMOKE 51 — Hepsiburada sipariş görünümü");
    const actorUserId = await getActorUserId();

    // ── 1. hbDate ─────────────────────────────────────────────────────────────
    step("hbDate: saat dilimsiz tarih İstanbul saati, 0001 boş...");
    assertEqual(hbDate("2026-11-14T10:11:59"), Date.parse("2026-11-14T07:11:59Z"), "naive → +03:00");
    assertEqual(hbDate("2026-11-18T15:14:20Z"), Date.parse("2026-11-18T15:14:20Z"), "Z korunur");
    assertEqual(hbDate("0001-01-01T00:00:00Z"), null, "0001 → null");
    assertEqual(hbDate(null), null, "null → null");

    // ── 2. collectPackages tekilleştirme ─────────────────────────────────────
    step("collectPackages: aynı paket birden çok listede → doğru kayıt seçilir...");
    const dupRaw: HbRawOrders = {
      packed: [packedPackage("O-A", "P-A", "X"), packedPackage("O-B", "P-B", "X")],
      events: {
        shipped: [
          { PackageNumber: "P-A", OrderNumber: "O-A", Barcode: "BA", ShippedDate: "2026-11-15T10:00:00" },
          { PackageNumber: "P-B", OrderNumber: "O-B", Barcode: "BB", ShippedDate: "2026-11-15T10:00:00" },
          { PackageNumber: "P-C", OrderNumber: "O-C", Barcode: "BC", ShippedDate: "2026-11-15T10:00:00" },
        ],
        delivered: [{ PackageNumber: "P-B", OrderNumber: "O-B", Barcode: "BB", DeliveredDate: "2026-11-16T10:00:00", HasInvoice: true }],
        undelivered: [{ PackageNumber: "P-C", OrderNumber: "O-C", Barcode: "BC", UndeliveredDate: "2026-11-16T10:00:00" }],
      },
      paid: [],
      cancelled: [],
    };
    const tabs = Object.fromEntries(collectPackages(dupRaw).map(e => [e.packageNumber, e.tab]));
    assertEqual(tabs["P-A"], "tasima", "kargoya hazır + kargoda → kargoda");
    assertEqual(tabs["P-B"], "teslim", "kargoda + teslim → teslim");
    assertEqual(tabs["P-C"], "yeniden", "kargoda + (daha yeni) teslim edilemedi → yeniden");

    // ── 3. buildHepsiburadaOrders saf ────────────────────────────────────────
    step("buildHepsiburadaOrders: sekme/tutar/barkod/link/foto doğru...");
    const raw: HbRawOrders = {
      packed: [packedPackage("O-NEW", "P-NEW", "SKU-NEW")],
      events: {
        shipped: [{ PackageNumber: "P-T1", OrderNumber: "O-TWO", Barcode: "BAR-T1", ShippedDate: "2026-11-16T15:14:20" }],
        delivered: [{ PackageNumber: "P-T2", OrderNumber: "O-TWO", Barcode: "BAR-T2", DeliveredDate: "2026-11-16T09:00:00", HasInvoice: true }],
        undelivered: [],
      },
      paid: [
        { id: "u1", orderNumber: "O-UNPACKED", orderDate: "2026-11-16T12:00:00", merchantSku: "SKU-U", name: "Paketsiz", quantity: 1, unitPrice: TRY(100), totalPrice: TRY(100) },
        { id: "u2", orderNumber: "O-NEW", orderDate: "2026-11-16T12:00:00", merchantSku: "SKU-NEW", quantity: 1 },
      ],
      cancelled: [
        { id: "c1", orderNumber: "O-CANCEL", orderDate: "2026-11-10T12:00:00", merchantSku: "SKU-C", quantity: 1, status: "CancelledByCustomer" },
        { id: "c2", orderNumber: "O-OLD-CANCEL", orderDate: "2026-01-01T12:00:00", merchantSku: "SKU-C", quantity: 1 },
      ],
    };
    const built = buildHepsiburadaOrders(
      raw,
      {
        details: new Map([[
          "O-TWO",
          detail("O-TWO", [
            { packageNumber: "P-T1", sku: "SKU-T1", status: "InTransit" },
            { packageNumber: "P-T2", sku: "SKU-T2", status: "Delivered" },
          ]),
        ]]),
        cargo: new Map([["P-T1", { packageNumber: "P-T1", cargoCompany: "PTT Kargo", trackingInfoUrl: "https://ptt.example/KP1" }]]),
        matchMap: new Map([["SKU-NEW", { productId: "1", internalName: "İç Buhurdanlık" }]]),
      },
      { windowStartMs: Date.parse("2026-10-01T00:00:00Z"), windowEndMs: Date.parse("2026-11-17T00:00:00Z") },
    );
    info("orders", built.orders.map(o => `${o.id}:${o.tab}`).join(", "));
    assertEqual(built.total, 5, "5 sipariş (hazır + 2 paket + paketsiz + iptal; eski iptal ve paketli siparişin paketsiz kopyası yok)");
    assertEqual(built.tabCounts.yeni, 2, "yeni: kargoya hazır + paketsiz");
    assertEqual(built.tabCounts.tasima, 1, "taşıma: 1");
    assertEqual(built.tabCounts.teslim, 1, "teslim: 1");
    assertEqual(built.tabCounts.diger, 1, "diğer: pencere içindeki iptal");

    const pNew = built.orders.find(o => o.packageId === "P-NEW")!;
    assertEqual(pNew.channel, "hepsiburada", "kanal");
    assertEqual(pNew.id, "hb:O-NEW::P-NEW", "id hb: önekli");
    assertEqual(pNew.tab, "yeni", "kargoya hazır → yeni");
    assertEqual(pNew.buyerName, "Ada K.", "alıcı");
    assertEqual(pNew.city, "İzmir", "şehir");
    assertEqual(pNew.district, "Torbalı", "ilçe = HB town");
    assertEqual(pNew.cargoProvider, "Yurtiçi Kargo", "kargo firması");
    assertEqual(pNew.cargoTrackingNumber, "62P-NEW7", "barkod → cargoTrackingNumber");
    assertEqual(pNew.agreedDeliveryDate, hbDate("2026-11-17T14:56:30.388"), "dueDate → kalan süre hedefi");
    assertEqual(pNew.billable, 550, "faturalanacak");
    assertEqual(pNew.discount, 50, "satıcı indirimi");
    assertEqual(pNew.saleAmount, 600, "satış tutarı = faturalanacak + indirim");
    const lNew = pNew.lines[0];
    assert(lNew.matched, "merchantSku iç ürüne eşlendi");
    assertEqual(lNew.internalName, "İç Buhurdanlık", "iç ürün adı");
    assertEqual(lNew.imageUrl, "https://productimages.hepsiburada.net/s/1/500/1.jpg", "foto {size}=500");
    assertEqual(lNew.color, "Kırmızı", "renk özelliği");
    assertEqual(lNew.unitPrice, 275, "birim fiyat");
    assert(!("lineTotal" in lNew), "iç ara alanlar yanıtta yok");

    const t1 = built.orders.find(o => o.packageId === "P-T1")!;
    assertEqual(t1.tab, "tasima", "kargoda → tasima");
    assertEqual(t1.lines.length, 1, "yalnız bu paketin kalemi");
    assertEqual(t1.lines[0].merchantSku, "SKU-T1", "doğru kalem");
    assertEqual(t1.status, "InTransit", "ham durum detaydan");
    assertEqual(t1.buyerName, "Nil T.", "alıcı detaydan");
    assertEqual(t1.district, "Pamukkale", "ilçe detaydan");
    assertEqual(t1.cargoTrackingNumber, "BAR-T1", "barkod listeden");
    assertEqual(t1.cargoTrackingLink, "https://ptt.example/KP1", "takip linki kargo bilgisinden");
    assertEqual(t1.lastModifiedDate, hbDate("2026-11-16T15:14:20"), "son değişim = kargoya verilme");

    assertEqual(t1.returnRequested, false, "iade talebi yok");

    const t2 = built.orders.find(o => o.packageId === "P-T2")!;
    assertEqual(t2.tab, "teslim", "teslim → teslim");

    // İade talebi açık teslim edilmiş paket: sekme değişmez, yalnız işaret.
    const claimed = buildHepsiburadaOrders(
      {
        packed: [],
        events: { shipped: [], undelivered: [], delivered: [{ PackageNumber: "P-R", OrderNumber: "O-R", Barcode: "BR", DeliveredDate: "2026-11-15T10:00:00" }] },
        paid: [],
        cancelled: [],
      },
      { details: new Map([["O-R", detail("O-R", [{ packageNumber: "P-R", sku: "S", status: "ClaimCreated" }])]]), cargo: new Map(), matchMap: new Map() },
    ).orders[0];
    assertEqual(claimed.tab, "teslim", "iade talebi açık → yine Teslim");
    assertEqual(claimed.returnRequested, true, "iade talebi işaretli");
    assert(t2.invoiced, "HasInvoice → faturalandı");
    assertEqual(t2.lastModifiedDate, hbDate("2026-11-16T09:00:00"), "son değişim = teslim");

    const unpacked = built.orders.find(o => o.orderNumber === "O-UNPACKED")!;
    assertEqual(unpacked.packageId, null, "paketsiz siparişin paket no'su yok");
    assertEqual(unpacked.id, "hb:O-UNPACKED", "paketsiz id");
    assert(!built.orders.some(o => o.orderNumber === "O-OLD-CANCEL"), "pencere dışı iptal süzüldü");
    assertEqual(built.orders[0].orderDate! >= built.orders[built.orders.length - 1].orderDate!, true, "yeniden eskiye sıralı");

    // ── 4. enrichmentNeeds ────────────────────────────────────────────────────
    step("enrichmentNeeds: yalnız ince kayıtlar; teslim kalıcı sayılır...");
    const needs = enrichmentNeeds(raw);
    assertEqual(needs.orderNumbers.length, 1, "tek detay çağrısı (O-TWO)");
    assertEqual(needs.orderNumbers[0].final, false, "O-TWO'nun bir paketi hâlâ kargoda → kalıcı değil");
    assertEqual(needs.packageNumbers.length, 2, "iki paketin kargo bilgisi");
    assertEqual(needs.packageNumbers.find(p => p.packageNumber === "P-T2")?.final, true, "teslim paket kalıcı");

    // ── 5. Flag kapalı ────────────────────────────────────────────────────────
    step("Flag KAPALI iken listHepsiburadaOrders reddetmeli...");
    const emptySource: HbOrderSource = {
      packedPackages: async () => [],
      packageEvents: async () => [],
      paidOrders: async () => [],
      cancelledOrders: async () => [],
      orderDetail: async () => null,
      cargoInfo: async () => null,
    };
    await updateSettings({ marketplaceSyncEnabled: false }, actorUserId);
    await assertRejects(
      () => listHepsiburadaOrders({}, { source: emptySource }),
      "MARKETPLACE_SYNC_DISABLED",
      "Flag kapalıyken liste engellenmeli",
    );

    // ── 6. Sahte kaynak + gerçek DB eşleşmesi + sightings ─────────────────────
    step("Sahte kaynakla liste: merchantSku eşleşmesi + sightings kaydı...");
    const product = await createProduct({ name: "SMOKE51 Ürün", price: "349.00", barcode: SKU });
    productIds.push(product.id);
    await createChannelListing(product.id, { channel: "hepsiburada", externalId: SKU, actorUserId });
    await updateSettings({ marketplaceSyncEnabled: true }, actorUserId);

    const orderNo = `SMOKE51-${stamp}`;
    orderNumbers.push(orderNo);
    const recentOrderDate = new Date(Date.now() + 3 * 3_600_000 - 3_600_000).toISOString().slice(0, 19); // 1 sa önce, İstanbul
    let detailCalls = 0;
    const source: HbOrderSource = {
      ...emptySource,
      packageEvents: async kind =>
        kind === "shipped" ? [{ PackageNumber: `${orderNo}-P`, OrderNumber: orderNo, Barcode: "6200001", ShippedDate: recentOrderDate }] : [],
      orderDetail: async n => {
        detailCalls += 1;
        const d = detail(n, [{ packageNumber: `${orderNo}-P`, sku: SKU, status: "InTransit" }]);
        return { ...d, orderDate: recentOrderDate };
      },
    };
    const list = await listHepsiburadaOrders({}, { source });
    assert(list.configured, "configured=true");
    assertEqual(list.total, 1, "1 sipariş");
    assertEqual(detailCalls, 1, "detay bir kez çekildi");
    const line = list.orders[0].lines[0];
    assert(line.matched, "satır channel_listings (hepsiburada) üzerinden eşlendi");
    assertEqual(line.internalProductId, product.id, "iç ürün");

    const seen = await pool.query<{ customer_name: string | null }>(
      `SELECT customer_name FROM channel_order_sightings WHERE channel = 'hepsiburada' AND order_number = $1`,
      [orderNo],
    );
    assertEqual(seen.rows.length, 1, "sightings kaydı açıldı (yeni sipariş bildirimi için)");
    assertEqual(seen.rows[0].customer_name, "Nil T.", "müşteri adı kaydedildi");

    ok("\nSMOKE 51 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    try {
      await updateSettings({ marketplaceSyncEnabled: originalFlag });
    } catch {
      // yut
    }
    if (orderNumbers.length > 0) {
      await pool
        .query(`DELETE FROM channel_order_sightings WHERE channel = 'hepsiburada' AND order_number = ANY($1::text[])`, [orderNumbers])
        .catch(() => undefined);
    }
    if (productIds.length > 0) {
      await pool.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [productIds]);
    }
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
