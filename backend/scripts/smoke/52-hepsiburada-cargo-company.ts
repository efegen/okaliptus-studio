/**
 * SMOKE 52 — Hepsiburada kargo firması değiştirme + takip
 *
 * Ağ YOK: HB'ye çıkmaz. Seçenek listesi, değiştirme (CANLI yazma) ve paket kargo
 * bilgisi sahte bağımlılıklarla enjekte edilir; sipariş snapshot'ı sahte kaynakla
 * doldurulur.
 *
 * Senaryo:
 *   1. marketplaceFulfillmentEnabled KAPALI → 409, HB'ye yazma denenmez.
 *   2. Seçenekler: yalnız aktif firmalar; mevcut firmanın kodu addan bulunur.
 *   3. Paketin seçeneklerinde olmayan kod → 422; zaten o firmadaysa → 400. Yazma yok.
 *   4. Geçerli değişiklik: tek PUT; HB henüz eski firmayı gösteriyor → "pending";
 *      liste siparişe cargoChange iliştirir.
 *   5. HB yeni firmayı gösterince yoklama → "applied"; firma + barkod + takip linki
 *      snapshot'a yamanır.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/52-hepsiburada-cargo-company.ts
 */

import {
  changeHepsiburadaCargoCompany,
  getHepsiburadaCargoChangeStatuses,
  getHepsiburadaCargoOptions,
  type HbCargoDeps,
} from "../../src/services/hepsiburada/order-cargo.service.js";
import { listHepsiburadaOrders, type HbOrderSource } from "../../src/services/hepsiburada/orders.service.js";
import { hbCargoTracker } from "../../src/services/hepsiburada/cargo-change.js";
import type { HepsiburadaPackage, HepsiburadaPackageCargoInfo } from "../../src/services/hepsiburada/client.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import { section, step, assert, assertEqual, assertRejects, closePool, ok, getActorUserId } from "./_shared.js";

const PN = `SMOKE52-${Date.now()}`;
const ORDER = `${PN}-O`;

function packed(cargoCompany: string, barcode: string): HepsiburadaPackage {
  return {
    packageNumber: PN,
    barcode,
    status: "Open",
    cargoCompany,
    orderDate: "2026-11-16T10:00:00",
    dueDate: "2026-11-17T10:00:00",
    recipientName: "Ada K.",
    shippingCity: "İzmir",
    isCargoChangable: true,
    items: [{ lineItemId: "l1", orderNumber: ORDER, merchantSku: "X", productName: "Buhurdanlık", quantity: 1, price: { amount: 349 }, totalPrice: { amount: 349 } }],
  };
}

const OPTIONS = [
  { Id: 1, Name: "Yurtiçi Kargo", ShortName: "YK", IsActive: true },
  { Id: 2, Name: "Aras Kargo", ShortName: "AR", IsActive: true, LogoUrl: "https://images.example/aras.svg" },
  { Id: 99, Name: "Kapalı Kargo", ShortName: "KK", IsActive: false },
];

async function run(): Promise<void> {
  const before = await getSettings();
  try {
    section("SMOKE 52 — Hepsiburada kargo firması değiştirme");
    const actorUserId = await getActorUserId();

    let changeCalls = 0;
    let cargoNow: HepsiburadaPackageCargoInfo = { packageNumber: PN, cargoCompany: "Yurtiçi Kargo", barcode: "6210001" };
    const deps: HbCargoDeps = {
      getOptions: async () => OPTIONS,
      change: async (pn, code) => {
        changeCalls += 1;
        assertEqual(pn, PN, "PUT doğru pakete");
        assertEqual(code, "AR", "PUT doğru kodla");
      },
      cargoInfo: async () => cargoNow,
    };

    // ── 1. Flag kapalı ────────────────────────────────────────────────────────
    step("Sipariş işleme KAPALI → 409, yazma yok...");
    await updateSettings({ marketplaceSyncEnabled: true, marketplaceFulfillmentEnabled: false }, actorUserId);
    await assertRejects(
      () => changeHepsiburadaCargoCompany({ packageId: PN, cargoCompany: "AR" }, deps),
      "MARKETPLACE_FULFILLMENT_DISABLED",
      "flag kapalıyken değiştirme engellenmeli",
    );
    assertEqual(changeCalls, 0, "HB'ye yazma denenmedi");

    // Snapshot: paket Yurtiçi'nde.
    const source: HbOrderSource = {
      packedPackages: async () => [packed("Yurtiçi Kargo", "6210001")],
      packageEvents: async () => [],
      paidOrders: async () => [],
      cancelledOrders: async () => [],
      orderDetail: async () => null,
      cargoInfo: async () => null,
    };
    await listHepsiburadaOrders({ windowDays: 90 }, { source, storeSnapshot: true });

    // ── 2. Seçenekler ─────────────────────────────────────────────────────────
    step("Seçenekler: yalnız aktifler, mevcut firma kodu...");
    const opts = await getHepsiburadaCargoOptions(PN, deps);
    assertEqual(opts.options.map(o => o.code).join(","), "YK,AR", "pasif firma listede yok");
    assertEqual(opts.currentCode, "YK", "mevcut firma addan bulundu");
    assertEqual(opts.options[1].logoUrl, "https://images.example/aras.svg", "logo taşındı");

    // ── 3. Geçersiz kod / aynı firma ─────────────────────────────────────────
    await updateSettings({ marketplaceFulfillmentEnabled: true }, actorUserId);
    step("Paketin seçeneklerinde olmayan kod → 422, aynı firma → 400...");
    await assertRejects(
      () => changeHepsiburadaCargoCompany({ packageId: PN, cargoCompany: "KK" }, deps),
      "CARGO_PROVIDER_NOT_ALLOWED",
      "pasif firma reddedilmeli",
    );
    await assertRejects(
      () => changeHepsiburadaCargoCompany({ packageId: PN, cargoCompany: "ZZ" }, deps),
      "CARGO_PROVIDER_NOT_ALLOWED",
      "listede olmayan kod reddedilmeli",
    );
    await assertRejects(
      () => changeHepsiburadaCargoCompany({ packageId: PN, cargoCompany: "YK" }, deps),
      "VALIDATION_ERROR",
      "zaten o firmadaysa reddedilmeli",
    );
    assertEqual(changeCalls, 0, "hiçbirinde HB'ye yazılmadı");

    // ── 4. Geçerli değişiklik → pending ──────────────────────────────────────
    step("Geçerli değişiklik: tek PUT, HB henüz eski firmada → pending...");
    const res = await changeHepsiburadaCargoCompany({ packageId: PN, cargoCompany: "ar", orderNumber: ORDER }, deps);
    assertEqual(changeCalls, 1, "tek PUT");
    assertEqual(res.name, "Aras Kargo", "hedef firma adı");
    assertEqual(res.change.status, "pending", "HB henüz yansıtmadı → pending");
    assertEqual(res.change.fromName, "Yurtiçi Kargo", "eski firma kaydedildi");
    assertEqual(res.change.fromTrackingNumber, "6210001", "eski barkod kaydedildi");

    const listed = await listHepsiburadaOrders({ windowDays: 90 }, { source, storeSnapshot: true });
    assertEqual(listed.orders[0].cargoChange?.status, "pending", "liste siparişe takip iliştirdi");

    // ── 5. HB yeni firmayı gösteriyor → applied + yama ───────────────────────
    step("HB yeni firmayı gösterince yoklama → applied, firma/barkod yamalı...");
    cargoNow = { packageNumber: PN, cargoCompany: "Aras Kargo", barcode: "6220009", trackingInfoUrl: "https://aras.example/t" };
    const statuses = await getHepsiburadaCargoChangeStatuses([PN], { check: true }, deps);
    assertEqual(statuses[0].change?.status, "applied", "applied");
    assertEqual(statuses[0].order?.cargoProvider, "Aras Kargo", "yeni firma");
    assertEqual(statuses[0].order?.cargoTrackingNumber, "6220009", "yeni barkod");
    assertEqual(statuses[0].order?.cargoTrackingLink, "https://aras.example/t", "takip linki");
    assert(statuses[0].order?.cargoChange?.status === "applied", "sipariş görünümünde de applied");

    ok("\nSMOKE 52 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    hbCargoTracker.clear();
    try {
      await updateSettings({
        marketplaceSyncEnabled: before.marketplaceSyncEnabled,
        marketplaceFulfillmentEnabled: before.marketplaceFulfillmentEnabled,
      });
    } catch {
      // yut
    }
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
