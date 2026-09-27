/**
 * SMOKE 34 — Kargo Firması Değiştir (Change Cargo Provider, Faz 2)
 *
 * Ağ YOK: changeOrderCargoProvider'a sahte client (changeProvider) enjekte edilir.
 * CANLI TY'ye HİÇ çıkılmaz. Doğrulama (packageId/whitelist) + flag davranışı +
 * kod normalizasyonu test edilir.
 *
 * Senaryo:
 *   1. Boş packageId → ValidationError (TY'ye gidilmez).
 *   2. Boş cargoProvider → ValidationError.
 *   3. Geçersiz kod (whitelist dışı) → CARGO_PROVIDER_NOT_ALLOWED (TY'ye gidilmez).
 *   4. Flag KAPALI → MARKETPLACE_FULFILLMENT_DISABLED (changeProvider HİÇ çağrılmaz).
 *   5. Flag AÇIK + geçerli → changeProvider doğru (packageId, KOD) ile çağrılır; sonuç
 *      döner ve takip kaydı "pending" açılır.
 *   6. Küçük harf kod ("arasmp") → "ARASMP"e normalize edilip gönderilir.
 *   7. Aynı paket hemen tekrar → önceden engellenmez, TY'ye gider; takip yeni hedefe geçer.
 *   8. Ad → kod tanıma (TY'nin serbest firma adları) + saf durum türetme (zaman aşımı).
 *   9. Durum yoklaması: TY hâlâ eski firma → pending; yeni firma → applied + taze paket
 *      (hedefli getOrders orderNumber + ≤14 gün pencere ile çağrılır).
 *  10. Liste yanıtı takip edilen pakete cargoChange iliştirir (applied yapışkan).
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/34-trendyol-cargo-provider.ts
 */

import {
  changeOrderCargoProvider,
  getCargoChangeStatuses,
  type OrderCargoDeps,
} from "../../src/services/trendyol/order-cargo.service.js";
import { cargoProviderCodeFromName } from "../../src/services/trendyol/cargo-providers.js";
import {
  CARGO_CHANGE_CONFIRM_TIMEOUT_MS,
  clearTrackedCargoChanges,
  isCargoChangeApplied,
  registerCargoChange,
  resolveCargoChange,
} from "../../src/services/trendyol/cargo-change-tracker.js";
import { listTrendyolOrders } from "../../src/services/trendyol/orders.service.js";
import type { GetOrdersParams, TrendyolOrdersResponse } from "../../src/services/trendyol/client.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import {
  section, step, info, assert, assertEqual,
  assertRejects, closePool, ok, getActorUserId,
} from "./_shared.js";

async function run(): Promise<void> {
  const before = await getSettings();
  const originalFlag = before.marketplaceFulfillmentEnabled;
  const originalSyncFlag = before.marketplaceSyncEnabled;

  try {
    section("SMOKE 34 — Kargo Firması Değiştir (Change Cargo Provider)");
    const actorUserId = await getActorUserId();
    clearTrackedCargoChanges();

    // Çağrıları kaydeden sahte client (CANLI TY yerine).
    let calls: Array<{ packageId: string; code: string }> = [];
    const okDeps = (): OrderCargoDeps => ({
      changeProvider: async (packageId, code) => { calls.push({ packageId, code }); },
    });

    // ── 1. Boş packageId → ValidationError ───────────────────────────────────
    step("Boş packageId → ValidationError...");
    await updateSettings({ marketplaceFulfillmentEnabled: true }, actorUserId);
    await assertRejects(
      () => changeOrderCargoProvider({ packageId: "  ", cargoProvider: "PTTMP" }, okDeps()),
      "VALIDATION_ERROR",
      "Boş packageId reddedilmeli",
    );

    // ── 2. Boş cargoProvider → ValidationError ───────────────────────────────
    step("Boş cargoProvider → ValidationError...");
    await assertRejects(
      () => changeOrderCargoProvider({ packageId: "12345", cargoProvider: "" }, okDeps()),
      "VALIDATION_ERROR",
      "Boş cargoProvider reddedilmeli",
    );

    // ── 3. Geçersiz kod → CARGO_PROVIDER_NOT_ALLOWED ─────────────────────────
    step("Whitelist dışı kod → CARGO_PROVIDER_NOT_ALLOWED (TY'ye gidilmez)...");
    calls = [];
    await assertRejects(
      () => changeOrderCargoProvider({ packageId: "12345", cargoProvider: "FAKEKARGO" }, okDeps()),
      "CARGO_PROVIDER_NOT_ALLOWED",
      "Tanımsız kargo kodu reddedilmeli",
    );
    assertEqual(calls.length, 0, "geçersiz kodda changeProvider HİÇ çağrılmamalı");

    // ── 4. Flag KAPALI → reddetmeli, TY'ye yazmadan ──────────────────────────
    step("Flag KAPALI → MARKETPLACE_FULFILLMENT_DISABLED (yazma denenmez)...");
    await updateSettings({ marketplaceFulfillmentEnabled: false }, actorUserId);
    calls = [];
    await assertRejects(
      () => changeOrderCargoProvider({ packageId: "12345", cargoProvider: "PTTMP" }, okDeps()),
      "MARKETPLACE_FULFILLMENT_DISABLED",
      "Flag kapalıyken değişiklik engellenmeli",
    );
    assertEqual(calls.length, 0, "flag kapalıyken changeProvider HİÇ çağrılmamalı");

    // ── 5. Flag AÇIK + geçerli → CANLI yol (sahte client) ────────────────────
    step("Flag AÇIK + geçerli kod → changeProvider doğru argümanla çağrılır...");
    await updateSettings({ marketplaceFulfillmentEnabled: true }, actorUserId);
    calls = [];
    const result = await changeOrderCargoProvider(
      { packageId: "998877", cargoProvider: "PTTMP" },
      okDeps(),
    );
    assertEqual(calls.length, 1, "changeProvider 1 kez çağrıldı");
    assertEqual(calls[0].packageId, "998877", "doğru packageId");
    assertEqual(calls[0].code, "PTTMP", "doğru kargo kodu");
    assertEqual(result.cargoProvider, "PTTMP", "sonuç kodu");
    assertEqual(result.name, "PTT Kargo", "insanca firma adı");
    assertEqual(result.change.status, "pending", "TY async → takip 'pending' başlar");
    assertEqual(result.change.toCode, "PTTMP", "takip hedef kodu");
    info("sonuç", JSON.stringify(result));

    // ── 6. Küçük harf kod → normalize ────────────────────────────────────────
    step("Küçük harf 'arasmp' → 'ARASMP'e normalize edilip gönderilir...");
    calls = [];
    const norm = await changeOrderCargoProvider(
      { packageId: "555", cargoProvider: "arasmp" },
      okDeps(),
    );
    assertEqual(calls[0].code, "ARASMP", "küçük harf büyük harfe normalize edildi");
    assertEqual(norm.name, "Aras Kargo", "normalize sonrası firma adı");

    // ── 7. Aynı paket hemen tekrar → önceden engellenmez ─────────────────────
    step("Aynı paket hemen tekrar → TY'ye gider, takip yeni hedefe geçer...");
    calls = [];
    const again = await changeOrderCargoProvider({ packageId: "998877", cargoProvider: "YKMP" }, okDeps());
    assertEqual(calls.length, 1, "ikinci değişiklik de TY'ye gönderildi");
    assertEqual(again.change.toCode, "YKMP", "takip yeni hedefe geçti");

    // ── 8. Ad → kod tanıma + saf durum türetme ───────────────────────────────
    step("TY firma adları koda çözülür; zaman aşımı 'unconfirmed' verir...");
    assertEqual(cargoProviderCodeFromName("Yurtiçi Kargo Marketplace"), "YKMP", "Yurtiçi Marketplace");
    assertEqual(cargoProviderCodeFromName("YURTİÇİ KARGO"), "YKMP", "büyük harf İ");
    assertEqual(cargoProviderCodeFromName("PTT Kargo Marketplace"), "PTTMP", "PTT Marketplace");
    assertEqual(cargoProviderCodeFromName("Trendyol Express"), "TEXMP", "Trendyol Express");
    assertEqual(cargoProviderCodeFromName("Kolay Gelsin Marketplace"), "KOLAYGELSINMP", "Kolay Gelsin");
    assertEqual(cargoProviderCodeFromName("Karaaslan Lojistik"), null, "'aras' kelime içinde eşleşmez");
    assert(isCargoChangeApplied({ toCode: "YKMP", fromName: "Aras Kargo" }, "Yurtiçi Kargo Marketplace"), "hedef ad → uygulandı");
    assert(!isCargoChangeApplied({ toCode: "YKMP", fromName: "Aras Kargo" }, "Aras Kargo Marketplace"), "eski ad → uygulanmadı");
    assert(isCargoChangeApplied({ toCode: "YKMP", fromName: "Aras Kargo" }, "Bilinmeyen Firma"), "tanınmayan yeni ad → uygulandı");
    const t0 = Date.now();
    const pure = registerCargoChange({
      packageId: "SMOKE34-PURE", orderNumber: null, orderDate: null, fromName: "Aras Kargo",
      fromTrackingNumber: null, toCode: "YKMP", toName: "Yurtiçi Kargo",
    }, t0);
    assertEqual(resolveCargoChange(pure, "Aras Kargo", t0 + 60_000).status, "pending", "1 dk → pending");
    assertEqual(
      resolveCargoChange(pure, "Aras Kargo", t0 + CARGO_CHANGE_CONFIRM_TIMEOUT_MS + 1).status,
      "unconfirmed",
      "zaman aşımı → unconfirmed",
    );
    assertEqual(
      resolveCargoChange(pure, "Yurtiçi Kargo", t0 + CARGO_CHANGE_CONFIRM_TIMEOUT_MS + 2).status,
      "applied",
      "geç de olsa yansırsa → applied",
    );
    assertEqual(resolveCargoChange(pure, "Aras Kargo", t0 + CARGO_CHANGE_CONFIRM_TIMEOUT_MS + 3).status, "applied", "applied yapışkan (bayat okuma geri çevirmez)");

    // ── 9. Durum yoklaması: hedefli TY kontrolü ──────────────────────────────
    step("Yoklama: TY eski firmayı döndürürken pending, yenisini döndürünce applied...");
    await updateSettings({ marketplaceSyncEnabled: true }, actorUserId);
    const ORDER_NO = `SMOKE34-${Date.now()}`;
    const PKG = `${Date.now()}`;
    let tyProvider = "Aras Kargo Marketplace";
    let tyTracking = "7330000000001";
    const seenParams: GetOrdersParams[] = [];
    const fakeFetch = async (params: GetOrdersParams): Promise<TrendyolOrdersResponse> => {
      seenParams.push(params);
      return {
        totalPages: 1,
        content: [{
          orderNumber: ORDER_NO, id: PKG, shipmentPackageStatus: "Created", orderDate: Date.now() - 86_400_000,
          cargoProviderName: tyProvider, cargoTrackingNumber: tyTracking, lines: [],
        }],
      };
    };

    const changed = await changeOrderCargoProvider(
      { packageId: PKG, cargoProvider: "YKMP", orderNumber: ORDER_NO },
      okDeps(),
    );
    assertEqual(changed.change.status, "pending", "değişiklik sonrası pending");

    let [st] = await getCargoChangeStatuses([PKG], {}, { fetchOrders: fakeFetch });
    assertEqual(st.change?.status, "pending", "TY hâlâ eski firma → pending");
    assertEqual(st.order?.cargoProvider, "Aras Kargo Marketplace", "taze paket eski firmayı gösteriyor");
    assert(seenParams.length === 1, "ilk yoklama TY'ye hedefli kontrol yaptı");
    assertEqual(seenParams[0].orderNumber, ORDER_NO, "getOrders orderNumber ile süzüldü");
    assert(
      (seenParams[0].endDate ?? 0) - (seenParams[0].startDate ?? 0) <= 14 * 86_400_000,
      "hedefli pencere ≤ 14 gün (TY sınırı)",
    );

    [st] = await getCargoChangeStatuses([PKG], {}, { fetchOrders: fakeFetch });
    assertEqual(seenParams.length, 1, "aralık dolmadan TY'ye tekrar gidilmez");

    tyProvider = "Yurtiçi Kargo Marketplace";
    tyTracking = "7330000000002";
    [st] = await getCargoChangeStatuses([PKG], { check: true }, { fetchOrders: fakeFetch });
    assertEqual(st.change?.status, "applied", "TY yeni firmayı döndürünce applied");
    assert(st.change?.appliedAt !== null, "appliedAt damgalandı");
    assertEqual(st.order?.cargoProvider, "Yurtiçi Kargo Marketplace", "taze paket yeni firmayı taşıyor");
    assertEqual(st.order?.cargoTrackingNumber, "7330000000002", "yeni kargo kodu da geldi");
    assertEqual(st.order?.cargoChange?.status, "applied", "paket cargoChange iliştirilmiş");

    const [unknown] = await getCargoChangeStatuses(["SMOKE34-YOK"], {}, { fetchOrders: fakeFetch });
    assertEqual(unknown.change, null, "takip kaydı olmayan paket → change null");

    // ── 10. Liste yanıtı cargoChange iliştirir ───────────────────────────────
    step("Liste: takip edilen paket cargoChange taşır, diğerleri taşımaz...");
    tyProvider = "Aras Kargo Marketplace"; // bayat bir okuma bile applied'ı geri çevirmemeli
    const list = await listTrendyolOrders({ windowDays: 14, includeAwaiting: false }, {
      fetchOrders: async (params) => {
        const own = await fakeFetch(params);
        own.content!.push({ orderNumber: `${ORDER_NO}-B`, id: `${PKG}9`, shipmentPackageStatus: "Created", lines: [] });
        return own;
      },
    });
    const tracked = list.orders.find(o => o.packageId === PKG);
    const other = list.orders.find(o => o.packageId === `${PKG}9`);
    assertEqual(tracked?.cargoChange?.status, "applied", "takip edilen paket applied");
    assertEqual(other?.cargoChange, undefined, "takipsiz paket cargoChange taşımaz");

    ok("\nSMOKE 34 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    clearTrackedCargoChanges();
    try {
      await updateSettings({
        marketplaceFulfillmentEnabled: originalFlag,
        marketplaceSyncEnabled: originalSyncFlag,
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
