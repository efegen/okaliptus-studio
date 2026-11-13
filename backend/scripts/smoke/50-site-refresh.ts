/**
 * SMOKE 50 — Web sitesi mağazası: otomatik yenileme (site-refresh.service.ts)
 *
 * Ağ YOK: Trendyol sayfaları ve build adresi sahte fonksiyonlarla enjekte edilir.
 * Saat `now` ile ileri alınır.
 *
 * Senaryo:
 *   1. Build adresi doğrulaması: yalnız https://api.cloudflare.com/…/deploy_hooks/….
 *   2. Liste 24 saatten yeniyse Trendyol'a gidilmez; eskiyse yenilenir.
 *   3. İlk bakışta parmak izi kaydedilir ve build adresine haber verilir;
 *      değişiklik yoksa tekrar haber verilmez.
 *   4. Panelden gizleme listeyi değiştirir → yeni haber.
 *   5. Build adresi hata verirse bir sonraki bakışta yeniden denenir.
 *   6. Trendyol boş liste döndürürse mevcut liste korunur.
 *   7. Liste boşsa haber verilmez (boş mağaza yayına çıkmaz).
 *   8. marketplace_sync_enabled kapalıysa Trendyol'a gidilmez.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/50-site-refresh.ts
 */

import { pool } from "../../src/db/connection.js";
import { runSiteRefresh, siteDeployHookUrl } from "../../src/services/site-refresh.service.js";
import { updateSiteProduct } from "../../src/services/site-catalog.service.js";
import type { GetApprovedProductsParams, TrendyolProductsResponse } from "../../src/services/trendyol/client.js";
import { section, step, assert, assertEqual, ok, closePool, getActorUserId } from "./_shared.js";

const P = "SMOKE50-";
const HOOK = "https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/smoke50";
const HOUR = 3_600_000;

function page(items: Array<{ main: string; title: string; price: number }>): TrendyolProductsResponse {
  return {
    totalPages: 1,
    content: items.map((it) => ({
      productMainId: P + it.main,
      title: it.title,
      images: [{ url: `https://cdn.dsmcdn.com/ty1/${it.main.toLowerCase()}.jpg` }],
      variants: [{
        barcode: P + it.main + "-1",
        onSale: true,
        archived: false,
        productUrl: `https://www.trendyol.com/okaliptus/${it.main.toLowerCase()}-p-50${it.price}`,
        stock: { quantity: 4 },
        price: { salePrice: it.price, listPrice: it.price },
      }],
    })),
  };
}

const TWO = page([
  { main: "LOTUS", title: "SMOKE50 Lotus Buhurdanlık", price: 299 },
  { main: "PALO", title: "SMOKE50 Palo Santo Tütsü", price: 120 },
]);

async function run(): Promise<void> {
  const saved = {
    interval: process.env.SITE_SYNC_INTERVAL_HOURS,
    hook: process.env.SITE_DEPLOY_HOOK_URL,
    settings: (await pool.query("SELECT marketplace_sync_enabled FROM studio_settings WHERE id = 1")).rows[0],
    state: (await pool.query("SELECT * FROM site_feed_state WHERE id = 1")).rows[0],
  };
  const actor = (await getActorUserId()) ?? 1;
  const hookCalls: string[] = [];
  let fetches = 0;
  let hookFails = false;
  const later = (h: number) => () => new Date(Date.now() + h * HOUR);
  const deps = (pages: TrendyolProductsResponse, h: number) => ({
    now: later(h),
    isConfigured: () => true,
    fetchPage: async (_p: GetApprovedProductsParams) => { fetches += 1; return pages; },
    callHook: async (url: string) => {
      if (hookFails) throw new Error("HTTP 500");
      hookCalls.push(url);
    },
  });

  try {
    section("SMOKE 50 — Web sitesi mağazası otomatik yenileme");
    await pool.query("DELETE FROM channel_products WHERE channel = 'trendyol'");
    await pool.query("DELETE FROM site_products WHERE product_key LIKE $1", [P + "%"]);
    await pool.query("UPDATE site_feed_state SET fingerprint = NULL, product_count = NULL, changed_at = NULL, hook_called_at = NULL WHERE id = 1");
    await pool.query("UPDATE studio_settings SET marketplace_sync_enabled = true WHERE id = 1");
    process.env.SITE_SYNC_INTERVAL_HOURS = "24";

    // ── 1. Build adresi ──────────────────────────────────────────────────────
    step("Build adresi yalnız Cloudflare Pages deploy hook'u olabilir");
    process.env.SITE_DEPLOY_HOOK_URL = "http://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/x";
    assertEqual(siteDeployHookUrl(), null, "http → yok sayılır");
    process.env.SITE_DEPLOY_HOOK_URL = "https://evil.example.com/client/v4/pages/webhooks/deploy_hooks/x";
    assertEqual(siteDeployHookUrl(), null, "başka alan adı → yok sayılır");
    process.env.SITE_DEPLOY_HOOK_URL = HOOK;
    assertEqual(siteDeployHookUrl(), HOOK, "Cloudflare deploy hook kabul");

    // ── 2-3. İlk yenileme ve haber ───────────────────────────────────────────
    step("Liste hiç yoksa yenilenir, parmak izi kaydedilir, build'e haber verilir");
    const r1 = await runSiteRefresh(deps(TWO, 0));
    assertEqual(r1.synced, true, "Trendyol'dan yenilendi");
    assertEqual(r1.productCount, 2, "sitede 2 ürün");
    assertEqual(r1.changed, true, "parmak izi yeni");
    assertEqual(hookCalls.length, 1, "build adresine 1 kez haber");

    step("Liste 24 saatten yeniyse Trendyol'a gidilmez, değişiklik yoksa haber yok");
    const before = fetches;
    const r2 = await runSiteRefresh(deps(TWO, 1));
    assertEqual(fetches, before, "Trendyol çağrılmadı");
    assertEqual(r2.synced, false, "yenileme yok");
    assertEqual(r2.changed, false, "değişiklik yok");
    assertEqual(hookCalls.length, 1, "yeni haber yok");

    step("24 saat geçince yenilenir");
    const r3 = await runSiteRefresh(deps(TWO, 25));
    assertEqual(r3.synced, true, "yeniden çekildi");
    assertEqual(r3.changed, false, "aynı liste → değişiklik yok");
    assertEqual(hookCalls.length, 1, "haber yok");

    // ── 4. Panel değişikliği ─────────────────────────────────────────────────
    step("Panelden gizleme listeyi değiştirir → haber");
    await updateSiteProduct(P + "PALO", { hidden: true }, actor);
    const r4 = await runSiteRefresh(deps(TWO, 1));
    assertEqual(r4.changed, true, "gizleme parmak izini değiştirdi");
    assertEqual(r4.productCount, 1, "sitede 1 ürün");
    assertEqual(hookCalls.length, 2, "ikinci haber");

    // ── 5. Build adresi hatası ───────────────────────────────────────────────
    step("Build adresi hata verirse sonraki bakışta yeniden denenir");
    await updateSiteProduct(P + "LOTUS", { displayName: "SMOKE50 Lotus" }, actor);
    hookFails = true;
    const r5 = await runSiteRefresh(deps(TWO, 1));
    assertEqual(r5.hookCalled, false, "başarısız haber");
    assert(r5.hookError !== null, "hata kaydedildi");
    hookFails = false;
    const r6 = await runSiteRefresh(deps(TWO, 1));
    assertEqual(r6.changed, false, "liste aynı");
    assertEqual(r6.hookCalled, true, "bekleyen haber yeniden gönderildi");
    assertEqual(hookCalls.length, 3, "üçüncü haber");

    // ── 6. Boş Trendyol yanıtı ───────────────────────────────────────────────
    step("Trendyol boş liste döndürürse mevcut liste korunur");
    const r7 = await runSiteRefresh(deps({ totalPages: 1, content: [] }, 25));
    assertEqual(r7.synced, false, "yenileme durdu");
    assert(String(r7.syncError).includes("boş"), "hata: boş liste");
    const kept = (await pool.query("SELECT count(*)::int n FROM channel_products WHERE external_id LIKE $1", [P + "%"])).rows[0].n;
    assertEqual(kept, 2, "2 varyant yerinde");

    // ── 7. Boş mağaza ────────────────────────────────────────────────────────
    step("Sitede ürün kalmazsa build'e haber verilmez");
    await updateSiteProduct(P + "LOTUS", { hidden: true }, actor);
    const r8 = await runSiteRefresh(deps(TWO, 1));
    assertEqual(r8.productCount, 0, "sitede 0 ürün");
    assertEqual(r8.changed, true, "değişti");
    assertEqual(r8.hookCalled, false, "boş liste için haber yok");
    assertEqual(hookCalls.length, 3, "haber sayısı aynı");

    // ── 8. Senkron kapalı ────────────────────────────────────────────────────
    step("marketplace_sync_enabled kapalıysa Trendyol'a gidilmez");
    await pool.query("UPDATE studio_settings SET marketplace_sync_enabled = false WHERE id = 1");
    const f0 = fetches;
    const r9 = await runSiteRefresh(deps(TWO, 50));
    assertEqual(fetches, f0, "Trendyol çağrılmadı");
    assertEqual(r9.synced, false, "yenileme yok");

    ok("SMOKE 50 tamam");
  } finally {
    if (saved.interval === undefined) delete process.env.SITE_SYNC_INTERVAL_HOURS;
    else process.env.SITE_SYNC_INTERVAL_HOURS = saved.interval;
    if (saved.hook === undefined) delete process.env.SITE_DEPLOY_HOOK_URL;
    else process.env.SITE_DEPLOY_HOOK_URL = saved.hook;
    await pool.query("DELETE FROM site_products WHERE product_key LIKE $1", [P + "%"]);
    await pool.query("DELETE FROM channel_products WHERE external_id LIKE $1", [P + "%"]);
    if (saved.settings) {
      await pool.query("UPDATE studio_settings SET marketplace_sync_enabled = $1 WHERE id = 1", [saved.settings.marketplace_sync_enabled]);
    }
    if (saved.state) {
      await pool.query(
        `UPDATE site_feed_state SET fingerprint = $1, product_count = $2, changed_at = $3,
           hook_called_at = $4, last_sync_at = $5, last_sync_error = $6 WHERE id = 1`,
        [saved.state.fingerprint, saved.state.product_count, saved.state.changed_at,
          saved.state.hook_called_at, saved.state.last_sync_at, saved.state.last_sync_error],
      );
    }
    await closePool();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
