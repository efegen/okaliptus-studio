/**
 * SMOKE 33 — Kargo Etiketi (Ortak Etiket / Common Label, Faz 2)
 *
 * Ağ YOK: getOrderCargoLabel'a sahte client (requestLabel/getLabel) + sleep stub
 * enjekte edilir. CANLI TY'ye HİÇ çıkılmaz. Flag (marketplaceFulfillmentEnabled)
 * davranışı + oluştur→getir akışı + async retry test edilir.
 *
 * Senaryo:
 *   1. Boş kargo takip no → ValidationError.
 *   2. Flag KAPALI → MARKETPLACE_FULFILLMENT_DISABLED (TY'ye yazma DENENMEZ).
 *   3. Flag AÇIK → requestLabel (oluştur) sonra getLabel (getir) çağrılır; sonuç döner.
 *   4. getLabel ilk denemede patlar, ikincide başarılı → servis retry'lar (sleep stub).
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/33-trendyol-order-label.ts
 */

import {
  getOrderCargoLabel,
  type OrderLabelDeps,
} from "../../src/services/trendyol/order-label.service.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import {
  section, step, info, assert, assertEqual,
  assertRejects, closePool, ok, getActorUserId,
} from "./_shared.js";

async function run(): Promise<void> {
  const before = await getSettings();
  const originalFlag = before.marketplaceFulfillmentEnabled;

  try {
    section("SMOKE 33 — Kargo Etiketi (Ortak Etiket / Common Label)");
    const actorUserId = await getActorUserId();

    // Çağrıları kaydeden sahte client.
    let requestCalls: Array<{ ctn: string; format: string }> = [];
    const okDeps = (): OrderLabelDeps => ({
      requestLabel: async (ctn, format) => { requestCalls.push({ ctn, format }); },
      getLabel: async (ctn) => ({ contentType: "application/pdf", base64: "JVBERi0xLjQK", }),
      sleep: async () => {}, // beklemeden
    });

    // ── 1. Boş ctn → ValidationError ─────────────────────────────────────────
    step("Boş kargo takip no → ValidationError...");
    await updateSettings({ marketplaceFulfillmentEnabled: true }, actorUserId);
    await assertRejects(
      () => getOrderCargoLabel("   ", "PDF", okDeps()),
      "VALIDATION_ERROR",
      "Boş ctn reddedilmeli",
    );

    // ── 2. Flag KAPALI → reddetmeli, TY'ye yazma denemeden ───────────────────
    step("Flag KAPALI → MARKETPLACE_FULFILLMENT_DISABLED (yazma denenmez)...");
    await updateSettings({ marketplaceFulfillmentEnabled: false }, actorUserId);
    requestCalls = [];
    await assertRejects(
      () => getOrderCargoLabel("7340033434197156", "PDF", okDeps()),
      "MARKETPLACE_FULFILLMENT_DISABLED",
      "Flag kapalıyken etiket engellenmeli",
    );
    assertEqual(requestCalls.length, 0, "flag kapalıyken requestLabel HİÇ çağrılmamalı");

    // ── 3. Flag AÇIK → oluştur + getir ───────────────────────────────────────
    step("Flag AÇIK → requestLabel sonra getLabel; sonuç döner...");
    await updateSettings({ marketplaceFulfillmentEnabled: true }, actorUserId);
    requestCalls = [];
    const result = await getOrderCargoLabel("7340033434197156", "PDF", okDeps());
    info("contentType", result.contentType);
    assertEqual(requestCalls.length, 1, "requestLabel 1 kez çağrıldı");
    assertEqual(requestCalls[0].ctn, "7340033434197156", "doğru kargo takip no");
    assertEqual(requestCalls[0].format, "PDF", "doğru format");
    assertEqual(result.cargoTrackingNumber, "7340033434197156", "sonuç ctn");
    assertEqual(result.format, "PDF", "sonuç format");
    assertEqual(result.base64, "JVBERi0xLjQK", "etiket base64 döndü");

    // ── 4. getLabel async-not-ready → retry ──────────────────────────────────
    step("getLabel ilk denemede patlar, ikincide başarılı → retry...");
    let getCalls = 0;
    const retryDeps: OrderLabelDeps = {
      requestLabel: async () => {},
      getLabel: async () => {
        getCalls += 1;
        if (getCalls < 2) throw new Error("etiket henüz hazır değil");
        return { contentType: "text/plain", text: "^XA...^XZ" };
      },
      sleep: async () => {},
    };
    const retried = await getOrderCargoLabel("123", "ZPL", retryDeps);
    assertEqual(getCalls, 2, "getLabel 2 kez denendi (retry)");
    assertEqual(retried.text, "^XA...^XZ", "ZPL metni döndü");

    ok("\nSMOKE 33 — TÜM ADIMLAR BAŞARILI ✓");
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
