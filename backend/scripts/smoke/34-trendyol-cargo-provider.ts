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
 *   5. Flag AÇIK + geçerli → changeProvider doğru (packageId, KOD) ile çağrılır; sonuç döner.
 *   6. Küçük harf kod ("arasmp") → "ARASMP"e normalize edilip gönderilir.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/34-trendyol-cargo-provider.ts
 */

import {
  changeOrderCargoProvider,
  type OrderCargoDeps,
} from "../../src/services/trendyol/order-cargo.service.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import {
  section, step, info, assertEqual,
  assertRejects, closePool, ok, getActorUserId,
} from "./_shared.js";

async function run(): Promise<void> {
  const before = await getSettings();
  const originalFlag = before.marketplaceFulfillmentEnabled;

  try {
    section("SMOKE 34 — Kargo Firması Değiştir (Change Cargo Provider)");
    const actorUserId = await getActorUserId();

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

    ok("\nSMOKE 34 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    try {
      await updateSettings({ marketplaceFulfillmentEnabled: originalFlag });
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
