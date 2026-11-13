/**
 * SMOKE 49 — Web sitesi mağazası: /site/products (site) + /site-products (panel)
 *
 * Ağ YOK: Trendyol'a çıkılmaz. channel_products'a SMOKE49- önekli sahte
 * varyantlar yazılır, uygulama geçici bir portta ayağa kaldırılır.
 *
 * Senaryo:
 *   1. guessCorner: başlıktan köşe tahmini.
 *   2. Anahtar: tanımsız → 404; başlıksız / yanlış → 401; doğru → 200.
 *      Yanıtta CORS izni yok, önbellek yok.
 *   3. Liste: satışta olmayan, arşivli ve linki Trendyol dışı ürün düşer;
 *      varyantlar tek ürün olur (en düşük fiyat, liste fiyatı, seçenek sayısı,
 *      stok); görsel Trendyol dışıysa boş gelir; yalnız izinli alanlar döner.
 *   4. Panel: oturumsuz 401; gizle → listeden düşer; köşe + ad değişir;
 *      geçersiz köşe / uzun ad / bilinmeyen ürün reddedilir.
 *   5. İstek sınırı: 15 dakikada 30 istekten sonra 429.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/49-site-feed.ts
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { guessCorner } from "../../src/services/site-catalog.service.js";
import { pool } from "../../src/db/connection.js";
import { section, step, assert, assertEqual, ok, closePool, seedAdminUser } from "./_shared.js";

const P = "SMOKE49-";
const FEED_KEYS = ["id", "name", "corner", "price", "listPrice", "fromPrice", "options", "inStock", "image", "url"].sort();
const idOf = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 12);

type Variant = {
  ext: string;
  main: string;
  title: string;
  sale: number | null;
  list?: number | null;
  qty?: number;
  onSale?: boolean;
  archived?: boolean;
  url?: string | null;
  image?: string | null;
};

async function insertVariant(v: Variant): Promise<void> {
  await pool.query(
    `INSERT INTO channel_products
       (channel, external_id, product_main_id, title, quantity, list_price, sale_price,
        on_sale, archived, product_url, image_url, raw)
     VALUES ('trendyol', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '{}'::jsonb)`,
    [
      P + v.ext, P + v.main, v.title, v.qty ?? 3, v.list ?? v.sale, v.sale,
      v.onSale ?? true, v.archived ?? false,
      v.url === undefined ? `https://www.trendyol.com/okaliptus/${v.main.toLowerCase()}-p-${v.ext.length}00?merchantId=1` : v.url,
      v.image === undefined ? `https://cdn.dsmcdn.com/ty1/${v.ext.toLowerCase()}.jpg` : v.image,
    ],
  );
}

async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM site_products WHERE product_key LIKE $1`, [P + "%"]);
  await pool.query(`DELETE FROM channel_products WHERE external_id LIKE $1`, [P + "%"]);
}

async function run(): Promise<void> {
  const admin = seedAdminUser();
  if (!admin) {
    section("SMOKE 49 — SKIPPED (BOOTSTRAP_ADMINS bulunamadı)");
    await closePool();
    return;
  }

  const savedToken = process.env.SITE_FEED_TOKEN;
  const feedToken = randomBytes(32).toString("hex");
  const server: Server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let session: string | null = null;

  async function feed(auth: string | null, origin?: string) {
    const headers: Record<string, string> = {};
    if (auth !== null) headers.Authorization = auth;
    if (origin) headers.Origin = origin;
    const r = await fetch(base + "/site/products", { headers });
    let json: any = null;
    try { json = await r.json(); } catch { /* boş */ }
    return { status: r.status, json, headers: r.headers };
  }

  async function panel(method: string, path: string, body?: unknown, withSession = true) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (withSession && session) headers.Cookie = `session=${session}`;
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json: any = null;
    try { json = await r.json(); } catch { /* boş */ }
    return { status: r.status, json };
  }

  const mine = (products: any[]) => products.filter((p) => String(p.name).startsWith("SMOKE49") || String(p.title ?? "").startsWith("SMOKE49"));

  try {
    section("SMOKE 49 — Web sitesi mağazası");
    await cleanup();

    // ── 1. Köşe tahmini ──────────────────────────────────────────────────────
    step("guessCorner başlıktan köşe tahmin eder");
    assertEqual(guessCorner("Taş Buhurdanlık"), "meditasyon", "Taş Buhurdanlık → meditasyon");
    assertEqual(guessCorner("Ahşap Geri Akış Tütsülük"), "arinma", "Tütsülük → arinma");
    assertEqual(guessCorner("Ametist Doğal Taş Bileklik"), "taslar", "Bileklik → taslar");
    assertEqual(guessCorner("Mantar Yoga Bloğu"), "pratik", "Yoga bloğu → pratik");
    assertEqual(guessCorner("Soya Mum 3 Koku"), "meditasyon", "Mum → meditasyon");
    assertEqual(guessCorner("Hediye Kutusu"), null, "tanınmayan → null");

    // ── Kurulum ──────────────────────────────────────────────────────────────
    await insertVariant({ ext: "LOTUS-1", main: "LOTUS", title: "SMOKE49 Lotus Buhurdanlık Turuncu", sale: 299, list: 349, qty: 5 });
    await insertVariant({ ext: "LOTUS-2", main: "LOTUS", title: "SMOKE49 Lotus Buhurdanlık Siyah", sale: 299, list: 349, qty: 0 });
    await insertVariant({ ext: "LOTUS-3", main: "LOTUS", title: "SMOKE49 Lotus Buhurdanlık Büyük", sale: 329, list: 329, qty: 2 });
    await insertVariant({ ext: "PALO-1", main: "PALO", title: "SMOKE49 Palo Santo Tütsü", sale: 120 });
    await insertVariant({ ext: "OFF-1", main: "OFF", title: "SMOKE49 Satışta Değil", sale: 90, onSale: false });
    await insertVariant({ ext: "ARCH-1", main: "ARCH", title: "SMOKE49 Arşivli Mum", sale: 90, archived: true });
    await insertVariant({ ext: "EVIL-1", main: "EVIL", title: "SMOKE49 Yabancı Link", sale: 50, url: "https://evil.example.com/x-p-1" });
    await insertVariant({ ext: "NOIMG-1", main: "NOIMG", title: "SMOKE49 Görseli Dışarıda Kayış", sale: 75, image: "https://example.com/i.jpg" });
    await insertVariant({ ext: "SOLD-1", main: "SOLD", title: "SMOKE49 Tükenen Bileklik", sale: 250, qty: 0 });

    // ── 2. Anahtar ───────────────────────────────────────────────────────────
    step("Anahtar tanımsızken uç yok (404)");
    delete process.env.SITE_FEED_TOKEN;
    assertEqual((await feed(`Bearer ${feedToken}`)).status, 404, "anahtar yok → 404");
    process.env.SITE_FEED_TOKEN = "kisa-anahtar";
    assertEqual((await feed("Bearer kisa-anahtar")).status, 404, "32 karakterden kısa anahtar → kapalı (404)");

    process.env.SITE_FEED_TOKEN = feedToken;
    step("Başlıksız ya da yanlış anahtar 401");
    const none = await feed(null);
    assertEqual(none.status, 401, "başlık yok → 401");
    assert(none.json?.data === undefined, "401 yanıtında veri yok");
    assertEqual((await feed(`Bearer ${randomBytes(32).toString("hex")}`)).status, 401, "yanlış anahtar → 401");
    assertEqual((await feed(feedToken)).status, 401, "Bearer öneki olmadan → 401");

    step("Doğru anahtar 200; CORS izni ve önbellek yok");
    const good = await feed(`Bearer ${feedToken}`, "https://evil.example.com");
    assertEqual(good.status, 200, "doğru anahtar → 200");
    assertEqual(good.headers.get("access-control-allow-origin"), null, "başka siteye CORS izni yok");
    assertEqual(good.headers.get("cache-control"), "no-store", "Cache-Control: no-store");

    // ── 3. Liste ─────────────────────────────────────────────────────────────
    step("Yalnız satıştaki, Trendyol linkli ürünler; izinli alanlar");
    const list = mine(good.json.data.products);
    const names = list.map((p: any) => p.name).sort();
    assertEqual(
      names.join(" | "),
      [
        "SMOKE49 Görseli Dışarıda Kayış",
        "SMOKE49 Lotus Buhurdanlık Turuncu",
        "SMOKE49 Palo Santo Tütsü",
        "SMOKE49 Tükenen Bileklik",
      ].join(" | "),
      "satışta olmayan, arşivli ve yabancı linkli düştü",
    );
    for (const p of list) {
      assertEqual(Object.keys(p).sort().join(","), FEED_KEYS.join(","), `${p.name}: yalnız izinli alanlar`);
    }
    const raw = JSON.stringify(good.json);
    assert(!raw.includes(P + "LOTUS"), "model kodu ve barkod yanıtta yok");
    assert(!raw.includes("quantity"), "stok adedi yanıtta yok");

    const lotus = list.find((p: any) => p.id === idOf(P + "LOTUS"));
    assert(!!lotus, "Lotus kimliği model kodunun özeti");
    assertEqual(lotus.price, 299, "Lotus: en düşük fiyat 299");
    assertEqual(lotus.listPrice, 349, "Lotus: liste fiyatı 349 (indirim)");
    assertEqual(lotus.fromPrice, true, "Lotus: fiyatlar farklı → fromPrice");
    assertEqual(lotus.options, 3, "Lotus: 3 seçenek");
    assertEqual(lotus.inStock, true, "Lotus: stokta");
    assertEqual(lotus.corner, "meditasyon", "Lotus: köşe tahmini meditasyon");
    assert(String(lotus.url).startsWith("https://www.trendyol.com/"), "Lotus: link trendyol.com");
    assert(String(lotus.image).startsWith("https://cdn.dsmcdn.com/"), "Lotus: görsel Trendyol sunucusunda");

    const palo = list.find((p: any) => p.id === idOf(P + "PALO"));
    assertEqual(palo.listPrice, null, "Palo: indirim yok → listPrice null");
    assertEqual(palo.fromPrice, false, "Palo: tek fiyat");
    assertEqual(palo.options, null, "Palo: tek seçenek → null");
    assertEqual(palo.corner, "arinma", "Palo: köşe arinma");

    const noimg = list.find((p: any) => p.id === idOf(P + "NOIMG"));
    assertEqual(noimg.image, null, "Trendyol dışı görsel → boş");
    const sold = list.find((p: any) => p.id === idOf(P + "SOLD"));
    assertEqual(sold.inStock, false, "stok 0 → inStock false");

    // ── 4. Panel ─────────────────────────────────────────────────────────────
    step("Panel ucu oturum ister");
    assertEqual((await panel("GET", "/site-products", undefined, false)).status, 401, "oturumsuz → 401");
    session = await login(admin.username, admin.password);

    const overview = await panel("GET", "/site-products");
    assertEqual(overview.status, 200, "GET /site-products 200");
    const panelOff = overview.json.data.products.find((p: any) => p.key === P + "OFF");
    assert(!!panelOff && panelOff.sellable === false, "panel satışta olmayanı da gösterir (sellable=false)");

    step("Gizle → siteden düşer, geri aç → döner");
    const hide = await panel("PATCH", `/site-products/${encodeURIComponent(P + "PALO")}`, { hidden: true });
    assertEqual(hide.status, 200, "gizle 200");
    assertEqual(hide.json.data.hidden, true, "yanıtta hidden=true");
    let after = mine((await feed(`Bearer ${feedToken}`)).json.data.products);
    assert(!after.some((p: any) => p.id === idOf(P + "PALO")), "gizli ürün sitede yok");
    await panel("PATCH", `/site-products/${encodeURIComponent(P + "PALO")}`, { hidden: false });
    after = mine((await feed(`Bearer ${feedToken}`)).json.data.products);
    assert(after.some((p: any) => p.id === idOf(P + "PALO")), "geri açılan ürün sitede");

    step("Köşe ve site adı");
    const edit = await panel("PATCH", `/site-products/${encodeURIComponent(P + "LOTUS")}`, {
      corner: "taslar",
      displayName: "  SMOKE49   Lotus Buhurdanlık  ",
    });
    assertEqual(edit.status, 200, "düzenle 200");
    assertEqual(edit.json.data.displayName, "SMOKE49 Lotus Buhurdanlık", "ad kırpıldı, boşluklar sadeleşti");
    assertEqual(edit.json.data.hidden, false, "verilmeyen alan (hidden) korunur");
    after = mine((await feed(`Bearer ${feedToken}`)).json.data.products);
    const lotus2 = after.find((p: any) => p.id === idOf(P + "LOTUS"));
    assertEqual(lotus2.name, "SMOKE49 Lotus Buhurdanlık", "sitede yeni ad");
    assertEqual(lotus2.corner, "taslar", "sitede seçilen köşe");
    const back = await panel("PATCH", `/site-products/${encodeURIComponent(P + "LOTUS")}`, { corner: null, displayName: "" });
    assertEqual(back.json.data.corner, null, "köşe otomatiğe döner");
    assertEqual(back.json.data.effectiveCorner, "meditasyon", "otomatik köşe kullanılır");
    assertEqual(back.json.data.displayName, null, "boş ad → Trendyol başlığı");

    step("Geçersiz istekler");
    assertEqual((await panel("PATCH", `/site-products/${encodeURIComponent(P + "LOTUS")}`, { corner: "mutfak" })).status, 400, "geçersiz köşe → 400");
    assertEqual((await panel("PATCH", `/site-products/${encodeURIComponent(P + "LOTUS")}`, { hidden: "evet" })).status, 400, "hidden metin → 400");
    assertEqual((await panel("PATCH", `/site-products/${encodeURIComponent(P + "LOTUS")}`, { displayName: "x".repeat(121) })).status, 400, "121 karakter ad → 400");
    assertEqual((await panel("PATCH", `/site-products/${encodeURIComponent(P + "YOK")}`, { hidden: true })).status, 404, "bilinmeyen ürün → 404");

    // ── 5. İstek sınırı ──────────────────────────────────────────────────────
    step("İstek sınırı: 30 istekten sonra 429");
    let limited = false;
    for (let i = 0; i < 35 && !limited; i += 1) {
      limited = (await feed(`Bearer ${feedToken}`)).status === 429;
    }
    assert(limited, "sınır aşılınca 429");

    ok("SMOKE 49 tamam");
  } finally {
    if (savedToken === undefined) delete process.env.SITE_FEED_TOKEN;
    else process.env.SITE_FEED_TOKEN = savedToken;
    if (session) await logout(session).catch(() => undefined);
    await cleanup();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
