// Hepsiburada test (SIT) ortamı adımları — canlı anahtar almak için HB'nin
// istediği test akışlarını tek tek çalıştırır. YALNIZ SIT'te çalışır.
//
// Kullanım (backend/ içinde):
//   npm run hb:sit -- listings                       Adım 1: bağlantı testi (yalnız okuma)
//   npm run hb:sit -- catalog-fast                   Adım 2: HB test barkodlarıyla hızlı yükleme
//   npm run hb:sit -- catalog-status <trackingId>    ürün durumu
//   npm run hb:sit -- catalog-approve|catalog-reject <merchantSku>   eşleşen onay / red
//   npm run hb:sit -- categories [arama]             uç kategoriler
//   npm run hb:sit -- category-attrs <categoryId>    kategori özellikleri
//   npm run hb:sit -- attr-values <categoryId> <attributeId>
//   npm run hb:sit -- catalog-import <ürünler.json>  tam ürün gönderme (dosya)
//   npm run hb:sit -- listing <hbSku>                Adım 3: tek listingin tüm alanları
//   npm run hb:sit -- stock <hbSku> <stok>           stok güncelle + sonucu sorgula
//   npm run hb:sit -- price <hbSku> <fiyat>          fiyat güncelle + sonucu sorgula
//   npm run hb:sit -- inventory <hbSku> <fiyat> <stok>   envanter güncelle + sonucu sorgula
//   npm run hb:sit -- deactivate|activate <hbSku>    satışa kapat / aç
//   npm run hb:sit -- unlock <hbSku> [...]           fiyat kilidini kaldır
//   npm run hb:sit -- order-create <hbSku> <adet> [kargoFirmaId]   Adım 4: test siparişi oluştur
//   npm run hb:sit -- orders                         ödemesi tamamlanmış (paketlenecek) kalemler
//   npm run hb:sit -- cancelled                      iptal edilen kalemler
//   npm run hb:sit -- order-detail <siparişNo>
//   npm run hb:sit -- packable <kalemId>             aynı pakete girebilecek kalemler
//   npm run hb:sit -- pack <kalemId> <adet> [--full] API ile paketle (--full: kargo/desi/depo da gider)
//   npm run hb:sit -- packages [--json]              paketlenmiş siparişler (otomatik paketlemede ana uç)
//   npm run hb:sit -- unpacked | unpack <paketNo>    bozulan paketler / paket boz
//   npm run hb:sit -- split <paketNo> <kalemId>      paketi böl (1+1)
//   npm run hb:sit -- cancel <kalemId> [nedenId]     satıcı iptali (paketsiz kalem)
//   npm run hb:sit -- invoice <paketNo> <pdf-url>    fatura linki gönder
//   npm run hb:sit -- finance                        muhasebe kayıtları (son 30 gün, salt okuma)
//
// Kimlik backend/.env'den okunur (HEPSIBURADA_*). Gizli anahtar ekrana basılmaz.

import { readFile } from "node:fs/promises";
import { env } from "../src/config/env.js";
import {
  HepsiburadaApiError,
  type HepsiburadaListing,
  type HepsiburadaOrderItem,
  type HepsiburadaPackage,
  cancelLineItem,
  getCancelledOrders,
  getFinanceTransactions,
  createTestOrder,
  getOrderDetail,
  getPackageableWith,
  getPackages,
  getPaidOrders,
  getUnpackedPackages,
  packLineItems,
  sendInvoiceLink,
  splitPackage,
  unpackPackage,
  type HepsiburadaUploadKind,
  activateListing,
  approvePrematch,
  bulkUnlock,
  deactivateListing,
  getUploadResult,
  uploadInventory,
  uploadPrice,
  uploadStock,
  fastListing,
  getCategories,
  getCategoryAttributeValues,
  getCategoryAttributes,
  getListings,
  getProductStatus,
  hepsiburadaBaseUrl,
  importProducts,
  isHepsiburadaConfigured,
  rejectPrematch,
} from "../src/services/hepsiburada/client.js";

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function listings(): Promise<void> {
  console.log(`→ GET ${hepsiburadaBaseUrl("listing")}/listings/merchantid/<merchantId>?offset=0&limit=10`);
  const res = await getListings({ offset: 0, limit: 10 });
  const rows = res.data.listings ?? [];
  console.log(`✔ HTTP ${res.status} — toplam listing: ${res.data.totalCount ?? "?"}`);
  for (const l of rows) {
    console.log(
      `  • ${l.hepsiburadaSku ?? "-"} | ${l.merchantSku ?? "-"} | fiyat ${l.price ?? "-"} | stok ${l.availableStock ?? "-"} | ${l.isSalable ? "satışta" : "satışa kapalı"}${l.isLocked ? " | KİLİTLİ" : ""}`,
    );
  }
}

// ── Adım 2: Katalog ──────────────────────────────────────────────────────────

// HB'nin test dokümanında "eşleşen onay/red" için verdiği barkodlar.
const TEST_BARCODES = ["7541828790114", "7541828790155", "7541828790080"];
const fastSku = (i: number) => `OKY-HBTEST-FAST-${i + 1}`;

function printJson(label: string, value: unknown): void {
  console.log(`${label}\n${JSON.stringify(value, null, 2)}`);
}

async function catalogFast(): Promise<void> {
  const items = TEST_BARCODES.map((barcode, i) => ({
    merchantSku: fastSku(i),
    productName: `Okaliptus HB test ürünü ${i + 1}`,
    barcode,
  }));
  console.log(`→ POST ${hepsiburadaBaseUrl("catalog")}/api/products/fastlisting (${items.length} ürün)`);
  for (const it of items) console.log(`  • ${it.merchantSku} — barkod ${it.barcode}`);
  const res = await fastListing(items);
  console.log(`✔ HTTP ${res.status}${res.correlationId ? ` · x-correlation-id ${res.correlationId}` : ""}`);
  printJson("Yanıt:", res.data);
}

async function catalogStatus(): Promise<void> {
  const trackingId = process.argv[3];
  if (!trackingId) fail("Kullanım: npm run hb:sit -- catalog-status <trackingId>");
  const res = await getProductStatus(trackingId);
  console.log(`✔ HTTP ${res.status} — ${res.data.totalElements ?? res.data.data?.length ?? 0} ürün`);
  for (const p of res.data.data ?? []) {
    console.log(
      `  • ${p.merchantSku ?? "-"} | barkod ${p.barcode ?? "-"} | hbSku ${p.hbSku ?? "-"} | ürün durumu: ${p.productStatus ?? "-"} | import: ${p.importStatus ?? "-"}`,
    );
    const notes = [...(p.importMessages ?? []), ...(p.validationResults ?? []), ...(p.rejectReasonsMessages ?? [])];
    if (notes.length) console.log(`      ${JSON.stringify(notes)}`);
  }
}

function skuArgs(usage: string): string[] {
  const skus = process.argv.slice(3);
  if (skus.length === 0) fail(usage);
  return skus;
}

async function catalogApprove(): Promise<void> {
  const skus = skuArgs("Kullanım: npm run hb:sit -- catalog-approve <merchantSku> [...]");
  const res = await approvePrematch(skus);
  console.log(`✔ Eşleşen onay — HTTP ${res.status} · ${skus.join(", ")}`);
  if (res.data) printJson("Yanıt:", res.data);
}

async function catalogReject(): Promise<void> {
  const skus = skuArgs("Kullanım: npm run hb:sit -- catalog-reject <merchantSku> [...]");
  const res = await rejectPrematch(skus);
  console.log(`✔ Eşleşen red — HTTP ${res.status} · ${skus.join(", ")}`);
  if (res.data) printJson("Yanıt:", res.data);
}

async function categories(): Promise<void> {
  const query = (process.argv[3] ?? "").toLocaleLowerCase("tr-TR");
  const found: string[] = [];
  let total = 0;
  for (let page = 0; page < 50; page += 1) {
    const res = await getCategories({ page, size: 2000 });
    const rows = res.data.data ?? [];
    total += rows.length;
    for (const c of rows) {
      const path = (c.paths ?? []).join(" > ") || c.displayName || c.name || "";
      if (!query || path.toLocaleLowerCase("tr-TR").includes(query)) found.push(`  • ${c.categoryId} — ${path}`);
    }
    if (rows.length === 0 || res.data.totalPages === undefined || page + 1 >= res.data.totalPages) break;
  }
  console.log(`✔ ${total} uç kategori; ${query ? `"${query}" geçen` : "ilk"} ${Math.min(found.length, 40)} gösteriliyor (eşleşen: ${found.length})`);
  for (const line of found.slice(0, 40)) console.log(line);
}

async function categoryAttrs(): Promise<void> {
  const categoryId = Number(process.argv[3]);
  if (!Number.isInteger(categoryId)) fail("Kullanım: npm run hb:sit -- category-attrs <categoryId>");
  const res = await getCategoryAttributes(categoryId);
  const d = res.data.data ?? {};
  for (const [label, list] of [
    ["Temel", d.baseAttributes],
    ["Kategori", d.attributes],
    ["Varyant", d.variantAttributes],
  ] as const) {
    console.log(`${label} özellikler (${list?.length ?? 0}):`);
    for (const a of list ?? []) {
      console.log(`  • ${a.id} — ${a.name} | ${a.type}${a.mandatory ? " | ZORUNLU" : ""}${a.multiValue ? " | çoklu" : ""}`);
    }
  }
}

async function attrValues(): Promise<void> {
  const categoryId = Number(process.argv[3]);
  const attributeId = process.argv[4];
  if (!Number.isInteger(categoryId) || !attributeId) fail("Kullanım: npm run hb:sit -- attr-values <categoryId> <attributeId>");
  const res = await getCategoryAttributeValues(categoryId, attributeId, { size: 100 });
  const rows = res.data.data ?? [];
  console.log(`✔ ${rows.length} değer: ${rows.map((v) => v.value).join(" · ")}`);
}

async function catalogImport(): Promise<void> {
  const file = process.argv[3];
  if (!file) fail("Kullanım: npm run hb:sit -- catalog-import <ürünler.json>");
  const products = JSON.parse(await readFile(file, "utf8")) as unknown;
  if (!Array.isArray(products)) fail("Dosya bir JSON dizisi olmalı.");
  // Dosyadaki merchant alanı her zaman .env'deki mağaza ile değiştirilir.
  const withMerchant = products.map((p) => ({ ...(p as object), merchant: env.hepsiburadaMerchantId }));
  console.log(`→ POST ${hepsiburadaBaseUrl("catalog")}/api/products/import (${withMerchant.length} ürün, dosya olarak)`);
  const res = await importProducts(withMerchant);
  console.log(`✔ HTTP ${res.status}${res.correlationId ? ` · x-correlation-id ${res.correlationId}` : ""}`);
  printJson("Yanıt:", res.data);
}

// ── Adım 3: Listeleme ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchListing(hbSku: string): Promise<HepsiburadaListing> {
  const res = await getListings({ hbSkuList: [hbSku], limit: 1 });
  const row = res.data.listings?.[0];
  if (!row) fail(`Listing bulunamadı: ${hbSku}`);
  return row;
}

function listingLine(l: HepsiburadaListing): string {
  return `${l.hepsiburadaSku} | ${l.merchantSku} | fiyat ${l.price} | stok ${l.availableStock} | kargoya veriliş ${l.dispatchTime ?? "-"} gün | ${l.isSalable ? "satışta" : "satışa kapalı"}${l.isLocked ? " | KİLİTLİ" : ""}`;
}

async function listing(): Promise<void> {
  const hbSku = process.argv[3];
  if (!hbSku) fail("Kullanım: npm run hb:sit -- listing <hbSku>");
  const l = await fetchListing(hbSku);
  console.log(`✔ ${listingLine(l)}`);
  printJson("Tüm alanlar:", l);
}

// Yüklemeyi gönderir, sonra sonuç "işleniyor"dan çıkana kadar (en fazla ~30 sn) sorgular.
async function sendAndCheck(kind: HepsiburadaUploadKind, send: () => Promise<{ data: { id?: string } }>): Promise<void> {
  const res = await send();
  const id = res.data.id;
  if (!id) fail(`Yükleme id'si dönmedi: ${JSON.stringify(res.data)}`);
  console.log(`✔ ${kind} gönderildi — yükleme id: ${id}`);
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await sleep(3000);
    const check = await getUploadResult(kind, id);
    const status = check.data.status ?? "?";
    console.log(`  sorgu ${attempt}: durum ${status}`);
    if (/done|fail|complete|error/i.test(status)) {
      printJson("Sonuç:", check.data);
      return;
    }
  }
  console.log("  (hâlâ işleniyor — daha sonra tekrar sorgulanabilir)");
}

function numArg(i: number, usage: string): number {
  const n = Number(process.argv[i]);
  if (!Number.isFinite(n)) fail(usage);
  return n;
}

async function stock(): Promise<void> {
  const usage = "Kullanım: npm run hb:sit -- stock <hbSku> <stok>";
  const l = await fetchListing(process.argv[3] ?? fail(usage));
  const availableStock = numArg(4, usage);
  console.log(`Önce: ${listingLine(l)}`);
  await sendAndCheck("stock-uploads", () =>
    uploadStock([{ hepsiburadaSku: l.hepsiburadaSku, merchantSku: l.merchantSku, availableStock }]),
  );
  console.log(`Sonra: ${listingLine(await fetchListing(l.hepsiburadaSku!))}`);
}

async function price(): Promise<void> {
  const usage = "Kullanım: npm run hb:sit -- price <hbSku> <fiyat>";
  const l = await fetchListing(process.argv[3] ?? fail(usage));
  const value = numArg(4, usage);
  console.log(`Önce: ${listingLine(l)}`);
  await sendAndCheck("price-uploads", () =>
    uploadPrice([{ hepsiburadaSku: l.hepsiburadaSku, merchantSku: l.merchantSku, price: value }]),
  );
  console.log(`Sonra: ${listingLine(await fetchListing(l.hepsiburadaSku!))}`);
}

async function inventory(): Promise<void> {
  const usage = "Kullanım: npm run hb:sit -- inventory <hbSku> <fiyat> <stok>";
  const l = await fetchListing(process.argv[3] ?? fail(usage));
  const value = numArg(4, usage);
  const availableStock = numArg(5, usage);
  console.log(`Önce: ${listingLine(l)}`);
  // Kargo / adres / teslimat profili listingin mevcut değerleriyle gönderilir.
  await sendAndCheck("inventory-uploads", () =>
    uploadInventory([
      {
        hepsiburadaSku: l.hepsiburadaSku,
        merchantSku: l.merchantSku,
        price: value,
        availableStock,
        cargoCompany1: l.cargoCompany1 || undefined,
        cargoCompany2: l.cargoCompany2 || undefined,
        cargoCompany3: l.cargoCompany3 || undefined,
        shippingAddressLabel: l.shippingAddressLabel || undefined,
        claimAddressLabel: l.claimAddressLabel || undefined,
        maximumPurchasableQuantity: l.maximumPurchasableQuantity ?? 0,
        shippingProfileName: l.shippingProfileName || undefined,
      },
    ]),
  );
  console.log(`Sonra: ${listingLine(await fetchListing(l.hepsiburadaSku!))}`);
}

async function toggle(kind: "activate" | "deactivate"): Promise<void> {
  const hbSku = process.argv[3];
  if (!hbSku) fail(`Kullanım: npm run hb:sit -- ${kind} <hbSku>`);
  console.log(`Önce: ${listingLine(await fetchListing(hbSku))}`);
  const res = kind === "activate" ? await activateListing(hbSku) : await deactivateListing(hbSku);
  console.log(`✔ ${kind} — HTTP ${res.status}${res.data ? ` · ${JSON.stringify(res.data)}` : ""}`);
  await sleep(3000);
  console.log(`Sonra: ${listingLine(await fetchListing(hbSku))}`);
}

async function unlock(): Promise<void> {
  const hbSkus = skuArgs("Kullanım: npm run hb:sit -- unlock <hbSku> [...]");
  const res = await bulkUnlock(hbSkus);
  console.log(`✔ Kilit kaldırma — HTTP ${res.status}${res.data ? ` · ${JSON.stringify(res.data)}` : ""}`);
}

// ── Adım 4: Sipariş ──────────────────────────────────────────────────────────

function argOrFail(i: number, usage: string): string {
  const v = process.argv[i];
  if (!v) fail(usage);
  return v;
}

async function orderCreate(): Promise<void> {
  const usage = "Kullanım: npm run hb:sit -- order-create <hbSku> <adet> [kargoFirmaId]";
  const l = await fetchListing(argOrFail(3, usage));
  const quantity = numArg(4, usage);
  const cargoCompanyId = process.argv[5] ? numArg(5, usage) : undefined;
  if (!l.listingId || !l.merchantSku || !l.hepsiburadaSku || !l.price) fail(`Listing eksik/fiyatsız: ${listingLine(l)}`);
  // HB sipariş numaraları 10 haneli; test için zaman damgasından üretilir.
  const orderNumber = String(Date.now()).slice(-10);
  console.log(
    `→ Test siparişi ${orderNumber}: ${quantity} × ${l.hepsiburadaSku} (${l.price} TL) · kargo firması ${cargoCompanyId ?? 1}`,
  );
  const res = await createTestOrder({
    orderNumber,
    cargoCompanyId,
    lines: [
      { listingId: l.listingId, merchantSku: l.merchantSku, hbSku: l.hepsiburadaSku, quantity, unitPrice: l.price, vatRate: 20 },
    ],
  });
  console.log(`✔ HTTP ${res.status}${res.correlationId ? ` · x-correlation-id ${res.correlationId}` : ""}`);
  printJson("Yanıt:", res.data);
}

async function orders(): Promise<void> {
  const res = await getPaidOrders({ limit: 50 });
  console.log(`✔ Ödemesi tamamlanmış (paketlenecek) kalem: ${res.data.totalCount ?? res.data.items?.length ?? 0}`);
  for (const o of res.data.items ?? []) {
    console.log(
      `  • sipariş ${o.orderNumber} | kalem ${o.id} | ${o.sku} / ${o.merchantSku} | ${o.quantity} adet | ${o.totalPrice?.amount ?? "-"} TL | ${o.status ?? "-"} | ${o.cargoCompany ?? "-"}`,
    );
  }
}

async function cancelled(): Promise<void> {
  const res = await getCancelledOrders({ limit: 50 });
  const rows = res.data.items ?? (Array.isArray(res.data) ? (res.data as HepsiburadaOrderItem[]) : []);
  console.log(`✔ İptal edilen kalem: ${res.data.totalCount ?? rows.length}`);
  for (const o of rows) console.log(`  • sipariş ${o.orderNumber} | kalem ${o.id} | ${o.sku} | ${o.quantity} adet | ${o.status ?? "-"}`);
  if (rows.length === 0) printJson("Ham yanıt:", res.data);
}

async function orderDetail(): Promise<void> {
  const res = await getOrderDetail(argOrFail(3, "Kullanım: npm run hb:sit -- order-detail <siparişNo>"));
  printJson(`✔ HTTP ${res.status}`, res.data);
}

async function packable(): Promise<void> {
  const res = await getPackageableWith(argOrFail(3, "Kullanım: npm run hb:sit -- packable <kalemId>"));
  printJson(`✔ Aynı pakete girebilecek kalemler — HTTP ${res.status}`, res.data);
}

async function pack(): Promise<void> {
  const usage = "Kullanım: npm run hb:sit -- pack <kalemId> <adet> [--full]";
  const id = argOrFail(3, usage);
  const quantity = numArg(4, usage);
  // --full: kargo firması (siparişteki kısa kod, ör. "YK"), desi ve depo bilgisini de gönderir.
  let extra = {};
  if (process.argv[5] === "--full") {
    const order = (await getPaidOrders({ limit: 50 })).data.items?.find((o) => o.id === id) as
      | (HepsiburadaOrderItem & { cargoCompanyModel?: { shortName?: string } })
      | undefined;
    extra = {
      cargoCompany: order?.cargoCompanyModel?.shortName ?? order?.cargoCompany,
      deci: 1,
      warehouse: { shippingAddressLabel: "BIRINCIL", shippingModel: "Standard" },
    };
    printJson("Ek paketleme bilgisi:", extra);
  }
  const res = await packLineItems([{ id, quantity }], extra);
  console.log(`✔ Paketleme — HTTP ${res.status}`);
  if (res.data) printJson("Yanıt:", res.data);
}

function packageLine(p: HepsiburadaPackage): string {
  const items = (p.items ?? [])
    .map((i) => `${i.orderNumber ?? "-"}/${i.orderLineId ?? i.lineItemId ?? "-"} ${i.sku ?? i.merchantSku ?? ""}×${i.quantity ?? "?"}`)
    .join(", ");
  return `paket ${p.packageNumber} | ${p.status ?? "-"} | ${p.cargoCompany ?? "-"} | ${p.recipientName ?? p.customerName ?? "-"} | ${items}`;
}

async function packages(): Promise<void> {
  const res = await getPackages({ limit: 50 });
  const rows = Array.isArray(res.data) ? res.data : [];
  console.log(`✔ Paketlenmiş (kargoya hazır) paket: ${rows.length}`);
  for (const p of rows) console.log(`  • ${packageLine(p)}`);
  if (process.argv[3] === "--json" && rows[0]) printJson("İlk paket (tüm alanlar):", rows[0]);
}

async function unpacked(): Promise<void> {
  const res = await getUnpackedPackages({ limit: 50 });
  console.log(`✔ Bozulan paket: ${res.data.totalCount ?? res.data.items?.length ?? 0}`);
  for (const p of res.data.items ?? []) console.log(`  • ${packageLine(p)}`);
}

async function unpack(): Promise<void> {
  const res = await unpackPackage(argOrFail(3, "Kullanım: npm run hb:sit -- unpack <paketNo>"));
  console.log(`✔ Paket bozma — HTTP ${res.status}${res.data ? ` · ${JSON.stringify(res.data)}` : ""}`);
}

async function split(): Promise<void> {
  const usage = "Kullanım: npm run hb:sit -- split <paketNo> <kalemId> (2 adetli kalemi 1+1 böler)";
  const packageNumber = argOrFail(3, usage);
  const orderLineId = argOrFail(4, usage);
  const res = await splitPackage(packageNumber, [[{ orderLineId, quantity: 1 }], [{ orderLineId, quantity: 1 }]]);
  console.log(`✔ Paket bölme — HTTP ${res.status}${res.data ? ` · ${JSON.stringify(res.data)}` : ""}`);
}

async function cancel(): Promise<void> {
  const usage = "Kullanım: npm run hb:sit -- cancel <kalemId> [iptalNedeniId]";
  const id = argOrFail(3, usage);
  // 83 = HB'nin varsayılan iptal nedeni (gönderilmez/geçersizse de 83 sayılır).
  const reasonId = process.argv[4] ? numArg(4, usage) : 83;
  const res = await cancelLineItem(id, reasonId);
  console.log(`✔ Satıcı iptali — HTTP ${res.status}${res.data ? ` · ${JSON.stringify(res.data)}` : ""}`);
}

async function invoice(): Promise<void> {
  const usage = "Kullanım: npm run hb:sit -- invoice <paketNo> <pdf-url>";
  const res = await sendInvoiceLink(argOrFail(3, usage), argOrFail(4, usage));
  console.log(`✔ Fatura linki — HTTP ${res.status}${res.data ? ` · ${JSON.stringify(res.data)}` : ""}`);
}

// ── Muhasebe (salt okuma) ────────────────────────────────────────────────────

async function finance(): Promise<void> {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  console.log(`→ GET ${hepsiburadaBaseUrl("finance")}/transactions/merchantid/<merchantId> (${day(start)} – ${day(end)})`);
  const res = await getFinanceTransactions({ recordDateStart: day(start), recordDateEnd: day(end), limit: 10 });
  console.log(`✔ HTTP ${res.status}`);
  printJson("Yanıt:", res.data);
}

const COMMANDS: Record<string, () => Promise<void>> = {
  finance,
  "order-create": orderCreate,
  orders,
  cancelled,
  "order-detail": orderDetail,
  packable,
  pack,
  packages,
  unpacked,
  unpack,
  split,
  cancel,
  invoice,
  listings,
  listing,
  stock,
  price,
  inventory,
  activate: () => toggle("activate"),
  deactivate: () => toggle("deactivate"),
  unlock,
  "catalog-fast": catalogFast,
  "catalog-status": catalogStatus,
  "catalog-approve": catalogApprove,
  "catalog-reject": catalogReject,
  categories,
  "category-attrs": categoryAttrs,
  "attr-values": attrValues,
  "catalog-import": catalogImport,
};

async function main(): Promise<void> {
  if (env.hepsiburadaEnv !== "sit") fail("Bu script yalnız test ortamında çalışır (HEPSIBURADA_ENV=sit).");
  if (!isHepsiburadaConfigured()) {
    fail("backend/.env içinde HEPSIBURADA_MERCHANT_ID, HEPSIBURADA_SECRET_KEY ve HEPSIBURADA_USER_AGENT dolu olmalı.");
  }
  const name = process.argv[2] ?? "";
  const command = COMMANDS[name];
  if (!command) fail(`Komut: ${Object.keys(COMMANDS).join(" | ")}`);
  console.log(`Hepsiburada SIT · merchant ${env.hepsiburadaMerchantId} · user-agent ${env.hepsiburadaUserAgent}`);
  try {
    await command();
  } catch (err) {
    if (err instanceof HepsiburadaApiError) {
      fail(`${err.message}${err.correlationId ? `\n  x-correlation-id: ${err.correlationId}` : ""}`);
    }
    throw err;
  }
}

void main();
