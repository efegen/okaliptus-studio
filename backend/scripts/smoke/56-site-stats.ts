/**
 * SMOKE 56 — Web sitesi ziyaret istatistikleri: POST /public/pulse (site) + /site-stats (panel)
 *
 * Ağ YOK. Uygulama geçici bir portta ayağa kaldırılır; "ziyaretçiler" ayrı
 * X-Forwarded-For ve tarayıcı kimliğiyle gelir. Zamanlayıcı başlatılmaz:
 * bellekteki değerler test içinde elle yazdırılır (flushSiteStats).
 *
 * Senaryo:
 *   1. Yardımcılar: sinyal ayrıştırma, kaynak sınıflandırma, tarayıcı kimliği,
 *      bot süzgeci, il tablosu.
 *   2. Uç: Origin yok / yabancı Origin 403; sitenin adresi 204 ve gövdesiz;
 *      bozuk gövde de 204; kapatma anahtarı 404.
 *   3. Ziyaret: reklam etiketli sayfa açılışı → ziyaret + sayfa satırı; IP hiçbir
 *      sütunda yok; ping bellekte, yazdırınca süre/kaydırma/bölüm; iç gezinme
 *      aynı ziyaret; form adımı; ayrılınca "şu an sitede"den düşer.
 *   4. Bot ve günlük tavan: kayıt yok.
 *   5. Başka kişi ayrı ziyaret; aynı kişi başka reklamdan gelirse yeni ziyaret.
 *   6. Yeniden başlatma: bellek silinse de sayfa sinyali satırına bağlanır;
 *      başkasının sayfa kimliğiyle gelen sinyal yok sayılır.
 *   7. Form: gönderilen talep, geldiği ziyaretin özetini taşır.
 *   8. Panel: oturumsuz 401, owner olmayan 403; özet ve canlı liste.
 *   9. Bakım: günlük özet yazılır, 90 günden eski ham satırlar silinir;
 *      1 yıldan eski talepler silinir.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/56-site-stats.ts
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { regionOfIp } from "../../src/services/site-geo.service.js";
import {
  classifySource,
  describeAgent,
  flushSiteStats,
  isBotAgent,
  liveSiteVisitors,
  parseSignal,
  resetSiteStatsMemory,
  runSiteStatsMaintenance,
  siteStatsIdle,
  todayKey,
} from "../../src/services/site-stats.service.js";
import { pool } from "../../src/db/connection.js";
import { section, step, assert, assertEqual, closePool, seedAdminUser } from "./_shared.js";

const P = "SMOKE56";
const SITE = "https://okaliptusyoga.com";
const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ENV_KEYS = ["SITE_STATS_ENABLED", "SITE_STATS_DAILY_VIEWS", "SITE_FORMS_ENABLED", "SITE_FORM_ORIGINS", "TURNSTILE_SECRET_KEY"] as const;

const pageId = () => randomUUID().replace(/-/g, "").slice(0, 16);
const NO_UTM = { source: null, medium: null, campaign: null, content: null, term: null };

async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM site_inquiries WHERE full_name LIKE $1`, [P + "%"]);
  await pool.query(`DELETE FROM site_visits WHERE entry_path LIKE '/smoke56%'`);
  // Son günlerin özeti test ziyaretlerini saymış olabilir: silinir ve kalan ham
  // satırlardan yeniden üretilir.
  await pool.query(`DELETE FROM site_stats_daily WHERE day >= $1::date - 3`, [todayKey()]);
  await runSiteStatsMaintenance();
}

async function run(): Promise<void> {
  const admin = seedAdminUser();
  if (!admin) {
    section("SMOKE 56 — SKIPPED (BOOTSTRAP_ADMINS bulunamadı)");
    await closePool();
    return;
  }

  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];

  const savedSetting = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM notification_settings WHERE key = 'site_inquiry'`,
  );
  await pool.query(`UPDATE notification_settings SET enabled = false WHERE key = 'site_inquiry'`);
  const savedRole = await pool.query<{ id: string; role: string }>(`SELECT id, role FROM users WHERE username = $1`, [admin.username]);

  const server: Server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let session: string | null = null;

  type Who = { ip: string; ua: string };
  const ayse: Who = { ip: "10.56.0.1", ua: PHONE_UA };
  const can: Who = { ip: "10.56.0.2", ua: DESKTOP_UA };

  async function pulse(body: unknown, who: Who, opts: { origin?: string | null; raw?: string } = {}) {
    const headers: Record<string, string> = {
      "Content-Type": "text/plain;charset=UTF-8",
      "X-Forwarded-For": who.ip,
      "User-Agent": who.ua,
    };
    const origin = opts.origin === undefined ? SITE : opts.origin;
    if (origin) headers.Origin = origin;
    const r = await fetch(base + "/public/pulse", { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) });
    const textBody = await r.text();
    await siteStatsIdle();
    return { status: r.status, body: textBody, headers: r.headers };
  }

  async function panel(pathname: string, withSession = true) {
    const headers: Record<string, string> = {};
    if (withSession && session) headers.Cookie = `session=${session}`;
    const r = await fetch(base + pathname, { headers });
    let json: any = null;
    try { json = await r.json(); } catch { /* boş */ }
    return { status: r.status, json };
  }

  const visitsOf = async (prefix = "/smoke56") =>
    (await pool.query(`SELECT * FROM site_visits WHERE entry_path LIKE $1 ORDER BY id`, [prefix + "%"])).rows;
  const pageRow = async (id: string) => (await pool.query(`SELECT * FROM site_pageviews WHERE page_id = $1`, [id])).rows[0] ?? null;

  try {
    section("SMOKE 56 — Web sitesi ziyaret istatistikleri");
    resetSiteStatsMemory();
    await cleanup();

    // ── 1. Yardımcılar ───────────────────────────────────────────────────────
    step("Sinyal ayrıştırma");
    {
      const view = parseSignal({ t: "view", p: "ABCDEF0123456789", u: "/dersler/?x=1#form", h: " Dersler ", r: "https://l.instagram.com/x", q: { us: "ig", um: "paid", m: "meta", zz: 1 }, w: 390.4, l: "tr-TR" });
      assert(view !== null && view.type === "view", "sayfa sinyali tanındı");
      if (view && view.type === "view") {
        assertEqual(view.pageId, "abcdef0123456789", "sayfa kimliği küçük harf");
        assertEqual(view.path, "/dersler", "yoldan sorgu, çapa ve sondaki eğik çizgi atılır");
        assertEqual(view.title, "Dersler", "başlık kırpılır");
        assertEqual(view.utm.source, "ig", "kampanya kaynağı");
        assertEqual(view.mark, "meta", "tıklama işareti yalnız 'vardı' bilgisidir");
        assertEqual(view.screenW, 390, "ekran genişliği tam sayı");
      }
      assertEqual(parseSignal({ t: "view", p: "kısa", u: "/" }), null, "geçersiz sayfa kimliği düşer");
      assertEqual(parseSignal({ t: "view", p: "abcdef0123456789", u: "https://evil.example/" }), null, "tam adres yol sayılmaz");
      assertEqual(parseSignal({ t: "event", p: "abcdef0123456789", n: "steal" }), null, "bilinmeyen olay düşer");
      assertEqual(parseSignal([1]), null, "dizi gövde düşer");
      const ping = parseSignal({ t: "ping", p: "abcdef0123456789", a: 9e12, s: 250, x: ["giris", "<script>", "Program", "giris"], c: 1234.6 });
      if (ping && ping.type === "ping") {
        assertEqual(ping.activeMs, 4 * 60 * 60 * 1000, "süre 4 saatle sınırlı");
        assertEqual(ping.scroll, 100, "kaydırma 100'le sınırlı");
        assertEqual(ping.sections.join(","), "giris,program", "bölüm kimlikleri süzülür, tekrar atılır");
        assertEqual(ping.lcp, 1235, "hız ölçüsü yuvarlanır");
      } else assert(false, "ping tanınmalıydı");
    }

    step("Kaynak sınıflandırma");
    {
      const src = (referrer: string | null, utm: Partial<typeof NO_UTM> = {}, mark: "meta" | "google" | null = null, ua = DESKTOP_UA) =>
        classifySource({ referrer, utm: { ...NO_UTM, ...utm }, mark, ua }).source;
      assertEqual(src(null, { source: "ig", medium: "paid" }, "meta", PHONE_UA), "instagram_ad", "etiketli Instagram reklamı");
      assertEqual(src(null, { source: "fb", medium: "paid" }), "facebook_ad", "etiketli Facebook reklamı");
      assertEqual(src("https://l.instagram.com/?u=x", {}, "meta"), "instagram", "etiketsiz Instagram tıklaması reklam sayılmaz");
      assertEqual(src(null, {}, null, PHONE_UA), "instagram", "Instagram uygulama içi tarayıcı");
      assertEqual(src("https://www.google.com/"), "google", "Google araması");
      assertEqual(src("https://www.google.com/", {}, "google"), "google_ad", "Google reklam işareti");
      assertEqual(src("https://chatgpt.com/"), "chatgpt", "ChatGPT");
      assertEqual(src(null, { source: "chatgpt.com" }), "chatgpt", "ChatGPT etiketi");
      assertEqual(src("https://www.perplexity.ai/search"), "perplexity", "Perplexity");
      assertEqual(src("https://gemini.google.com/app"), "gemini", "Gemini, Google'dan önce tanınır");
      assertEqual(src("https://claude.ai/chat/x"), "claude", "Claude");
      assertEqual(src("https://okaliptusyoga.com/dersler"), "direct", "sitenin kendi sayfası kaynak değildir");
      assertEqual(src(null), "direct", "adres yazarak");
      assertEqual(src("https://ornek-blog.example/yazi"), "other", "başka site");
      assertEqual(classifySource({ referrer: "https://www.ornek-blog.example/yazi", utm: NO_UTM, mark: null, ua: DESKTOP_UA }).referrerHost, "ornek-blog.example", "geldiği sitenin yalnız alan adı");
    }

    step("Tarayıcı kimliği, bot süzgeci ve il tablosu");
    {
      assertEqual(JSON.stringify(describeAgent(PHONE_UA)), JSON.stringify({ device: "phone", os: "iOS", browser: "Instagram" }), "telefon, iOS, Instagram");
      assertEqual(JSON.stringify(describeAgent(DESKTOP_UA)), JSON.stringify({ device: "desktop", os: "Windows", browser: "Chrome" }), "bilgisayar, Windows, Chrome");
      assertEqual(describeAgent("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/131.0 Safari/537.36").device, "tablet", "Mobile yazmayan Android tablettir");
      assert(isBotAgent("Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)"), "GPTBot bot");
      assert(isBotAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), "Googlebot bot");
      assert(isBotAgent("curl/8.4.0"), "curl bot");
      assert(isBotAgent(""), "kimliksiz istek bot");
      assert(!isBotAgent(PHONE_UA) && !isBotAgent(DESKTOP_UA), "gerçek tarayıcılar bot değil");

      assertEqual(regionOfIp("127.0.0.1"), null, "özel adresin ili yok");
      assertEqual(regionOfIp("çöp"), null, "geçersiz adresin ili yok");
      const geo = JSON.parse(readFileSync(path.resolve(process.cwd(), "geo", "tr-regions.json"), "utf8")) as { provinces: string[]; v4: number[] };
      const start = geo.v4[0];
      const ip = [start >>> 24, (start >>> 16) & 255, (start >>> 8) & 255, start & 255].join(".");
      assertEqual(regionOfIp(ip), geo.provinces[geo.v4[2]], "tablodaki ilk aralığın ili bulunur");
      assertEqual(regionOfIp(`::ffff:${ip}`), geo.provinces[geo.v4[2]], "IPv4 eşlemeli IPv6 biçimi de");
      assertEqual(geo.provinces.length, 81, "81 il");
    }

    // ── 2. Uç ────────────────────────────────────────────────────────────────
    step("Uç: yalnız sitenin adresi yazar; yanıt gövdesiz 204");
    {
      const noOrigin = await pulse({ t: "view", p: pageId(), u: "/smoke56/yok" }, ayse, { origin: null });
      assertEqual(noOrigin.status, 403, "Origin yok → 403");
      const foreign = await pulse({ t: "view", p: pageId(), u: "/smoke56/yok" }, ayse, { origin: "https://evil.example" });
      assertEqual(foreign.status, 403, "yabancı Origin → 403");
      const broken = await pulse(null, ayse, { raw: "{bozuk" });
      assertEqual(broken.status, 204, "bozuk gövde de 204");
      assertEqual(broken.body, "", "gövde boş");
      assertEqual(broken.headers.get("access-control-allow-origin"), SITE, "Allow-Origin sitenin adresi");
      assertEqual(broken.headers.get("access-control-allow-credentials"), null, "çerez izni yok");
      assertEqual(broken.headers.get("set-cookie"), null, "çerez yazılmaz");
      const huge = await pulse(null, ayse, { raw: "x".repeat(10_000) });
      assertEqual(huge.status, 204, "büyük gövde de 204");
      assertEqual((await visitsOf()).length, 0, "bunların hiçbiri ziyaret açmadı");

      process.env.SITE_STATS_ENABLED = "false";
      assertEqual((await pulse({ t: "view", p: pageId(), u: "/smoke56/yok" }, ayse)).status, 404, "kapatma anahtarı → 404");
      delete process.env.SITE_STATS_ENABLED;
    }

    // ── 3. Ziyaret ───────────────────────────────────────────────────────────
    step("Reklamdan gelen ziyaret kaydedilir; IP saklanmaz");
    const p1 = pageId();
    let visitId = "";
    {
      const r = await pulse(
        { t: "view", p: p1, u: "/smoke56/kamp", h: "Smoke Kampı", r: "", q: { us: "ig", um: "paid", uc: `${P} Kamp`, un: "Video 2", m: "meta" }, w: 390, l: "tr-TR" },
        ayse,
      );
      assertEqual(r.status, 204, "sayfa sinyali 204");
      const visits = await visitsOf();
      assertEqual(visits.length, 1, "bir ziyaret");
      const v = visits[0];
      visitId = v.id;
      assertEqual(v.source, "instagram_ad", "kaynak Instagram reklamı");
      assertEqual(v.utm_campaign, `${P} Kamp`, "kampanya adı");
      assertEqual(v.utm_content, "Video 2", "reklam adı");
      assertEqual(v.click_mark, "meta", "tıklama işareti türü");
      assertEqual(v.device, "phone", "cihaz");
      assertEqual(v.browser, "Instagram", "tarayıcı");
      assertEqual(v.region, null, "özel adresin ili yok");
      assertEqual(v.entry_path, "/smoke56/kamp", "giriş sayfası");
      assert(!JSON.stringify(v).includes(ayse.ip), "ziyaret satırında IP yok");
      assert(/^[0-9a-f]{40}$/.test(v.visitor_key), "ziyaretçi anahtarı özet");
      const page = await pageRow(p1);
      assertEqual(page.title, "Smoke Kampı", "sayfa başlığı");
      assertEqual(String(page.visit_id), String(visitId), "sayfa ziyarete bağlı");
      const salts = await pool.query(`SELECT day::text FROM site_stat_salts`);
      assertEqual(salts.rows.length, 1, "yalnız bugünün tuzu duruyor");
      assertEqual(salts.rows[0].day, todayKey(), "tuzun günü bugün");
    }

    step("Aynı sayfa sinyali tekrar gelirse yeni satır açılmaz");
    {
      await pulse({ t: "view", p: p1, u: "/smoke56/kamp" }, ayse);
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM site_pageviews WHERE page_id = $1`, [p1]);
      assertEqual(rows[0].n, 1, "tek sayfa satırı");
    }

    step("Ping bellekte durur, yazdırınca süre, kaydırma ve bölümler satıra geçer");
    {
      await pulse({ t: "ping", p: p1, a: 15_000, s: 40, x: ["program"], c: 1400 }, ayse);
      assertEqual((await pageRow(p1)).active_ms, 0, "ping veritabanına hemen yazmaz");
      const live = liveSiteVisitors();
      const me = live.visitors.find((x) => x.path === "/smoke56/kamp");
      assert(me !== undefined, "şu an sitede görünüyor");
      assertEqual(me?.source, "instagram_ad", "canlı listede kaynak");
      assertEqual(me?.content, "Video 2", "canlı listede reklam adı");
      await pulse({ t: "ping", p: p1, a: 30_000, s: 85, x: ["program", "giris"] }, ayse);
      await pulse({ t: "ping", p: p1, a: 20_000, s: 10, x: [] }, ayse);
      await flushSiteStats();
      const page = await pageRow(p1);
      assertEqual(page.active_ms, 30_000, "süre en büyük değer");
      assertEqual(page.max_scroll, 85, "kaydırma en büyük değer");
      assertEqual([...page.sections].sort().join(","), "giris,program", "görülen bölümler");
      assertEqual(page.lcp_ms, 1400, "hız ölçüsü ilk değer");
    }

    step("Form adımları olay olarak yazılır; açık form canlı listede görünür");
    {
      await pulse({ t: "event", p: p1, n: "form_open", k: "camp" }, ayse);
      assertEqual(liveSiteVisitors().visitors.find((x) => x.path === "/smoke56/kamp")?.formOpen, "camp", "form açık");
      await pulse({ t: "event", p: p1, n: "form_start", k: "camp" }, ayse);
      await pulse({ t: "event", p: p1, n: "click", k: "telefon" }, ayse);
      const { rows } = await pool.query(`SELECT name, label FROM site_events WHERE visit_id = $1 ORDER BY id`, [visitId]);
      assertEqual(rows.map((e) => `${e.name}:${e.label}`).join(" "), "form_open:camp form_start:camp click:telefon", "üç olay");
    }

    step("İç gezinme aynı ziyarette kalır; ayrılan sayfa canlı listeden düşer");
    const p2 = pageId();
    {
      await pulse({ t: "leave", p: p1, a: 42_000, s: 90, x: ["sss"] }, ayse);
      assertEqual((await pageRow(p1)).active_ms, 42_000, "ayrılınca süre hemen yazılır");
      assert(!liveSiteVisitors().visitors.some((x) => x.path === "/smoke56/kamp"), "ayrılan sayfa canlıda yok");
      await pulse({ t: "view", p: p2, u: "/smoke56/galeri", h: "Smoke Galeri", r: `${SITE}/smoke56/kamp` }, ayse);
      assertEqual((await visitsOf()).length, 1, "hâlâ tek ziyaret");
      assertEqual(String((await pageRow(p2)).visit_id), String(visitId), "ikinci sayfa aynı ziyarette");
      const me = liveSiteVisitors().visitors.find((x) => x.path === "/smoke56/galeri");
      assertEqual(me?.trail.map((t) => t.path).join(","), "/smoke56/kamp", "önce gezdiği sayfa");
    }

    // ── 4. Bot ve günlük tavan ───────────────────────────────────────────────
    step("Botlar ve günlük tavanı aşan sayfalar kaydedilmez");
    {
      await pulse({ t: "view", p: pageId(), u: "/smoke56/bot" }, { ip: "10.56.0.9", ua: "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)" });
      process.env.SITE_STATS_DAILY_VIEWS = "0";
      await pulse({ t: "view", p: pageId(), u: "/smoke56/tavan" }, { ip: "10.56.0.10", ua: DESKTOP_UA });
      delete process.env.SITE_STATS_DAILY_VIEWS;
      assertEqual((await visitsOf()).length, 1, "ikisi de ziyaret açmadı");
    }

    // ── 5. Başka kişi, başka reklam ──────────────────────────────────────────
    step("Başka kişi ayrı ziyaret; aynı kişi başka reklamdan gelince yeni ziyaret");
    const p3 = pageId();
    {
      await pulse({ t: "view", p: p3, u: "/smoke56/dersler", h: "Smoke Dersler", r: "https://chatgpt.com/" }, can);
      const visits = await visitsOf();
      assertEqual(visits.length, 2, "iki ziyaret");
      assertEqual(visits[1].source, "chatgpt", "ikincinin kaynağı ChatGPT");
      assertEqual(visits[1].referrer_host, "chatgpt.com", "geldiği alan adı");
      assert(visits[0].visitor_key !== visits[1].visitor_key, "anahtarlar farklı");

      await pulse({ t: "view", p: pageId(), u: "/smoke56/kamp", q: { us: "ig", um: "paid", uc: `${P} Kamp`, un: "Afiş" } }, ayse);
      const after = await visitsOf();
      assertEqual(after.length, 3, "başka reklam yeni ziyaret açtı");
      assertEqual(after[2].visitor_key, after[0].visitor_key, "aynı kişi, aynı gün: aynı anahtar");
      assertEqual(after[2].utm_content, "Afiş", "yeni ziyaretin reklamı");
    }

    // ── 6. Yeniden başlatma ──────────────────────────────────────────────────
    step("Bellek silinse de sayfa sinyali satırına bağlanır; başkasının kimliği işe yaramaz");
    {
      await flushSiteStats();
      resetSiteStatsMemory();
      assertEqual(liveSiteVisitors().count, 0, "bellek boş");
      await pulse({ t: "ping", p: p3, a: 12_000, s: 30, x: ["form"] }, can);
      await flushSiteStats();
      assertEqual((await pageRow(p3)).active_ms, 12_000, "süre yeniden bağlanan sayfaya yazıldı");
      assert(liveSiteVisitors().visitors.some((x) => x.path === "/smoke56/dersler"), "yeniden canlıda");

      await pulse({ t: "ping", p: p3, a: 999_000, s: 100, x: [] }, { ip: "10.56.0.66", ua: DESKTOP_UA });
      await flushSiteStats();
      assertEqual((await pageRow(p3)).active_ms, 12_000, "başka ziyaretçinin sinyali satırı değiştirmedi");
      assertEqual((await visitsOf()).length, 3, "ping tek başına ziyaret açmaz");
    }

    // ── 7. Form → ziyaret özeti ──────────────────────────────────────────────
    step("Gönderilen talep, geldiği ziyaretin özetini taşır");
    let inquiryId = "";
    {
      const clientId = randomUUID();
      const r = await fetch(base + "/public/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: SITE, "X-Forwarded-For": ayse.ip, "User-Agent": ayse.ua },
        body: JSON.stringify({
          clientId,
          kind: "camp",
          name: `${P} Ayşe Yılmaz`,
          phone: "0532 556 00 01",
          page: "/smoke56/kamp",
          elapsedMs: 20_000,
          trap: "",
          details: { event: "smoke56", eventTitle: "Smoke Kampı", people: 1 },
        }),
      });
      assertEqual(r.status, 201, "form 201");
      let row: any = null;
      for (let i = 0; i < 40 && !row?.origin; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await siteStatsIdle();
        row = (await pool.query(`SELECT id, origin FROM site_inquiries WHERE client_id = $1`, [clientId])).rows[0];
      }
      assert(row?.origin, "talebe ziyaret özeti yazıldı");
      inquiryId = String(row.id);
      assertEqual(row.origin.source, "instagram_ad", "özet: kaynak");
      assertEqual(row.origin.campaign, `${P} Kamp`, "özet: kampanya");
      assertEqual(row.origin.content, "Afiş", "özet: en son geldiği reklam");
      assertEqual(row.origin.device, "phone", "özet: cihaz");
      assert(Array.isArray(row.origin.pages) && row.origin.pages.length === 1, "özet: o ziyarette gezilen sayfalar");
      assert(!JSON.stringify(row.origin).includes(ayse.ip), "özette IP yok");
    }

    // ── 8. Panel ─────────────────────────────────────────────────────────────
    step("Panel: oturumsuz 401, owner olmayan 403");
    {
      assertEqual((await panel("/site-stats/overview", false)).status, 401, "oturumsuz 401");
      session = await login(admin.username, admin.password);
      await pool.query(`UPDATE users SET role = 'admin' WHERE username = $1`, [admin.username]);
      assertEqual((await panel("/site-stats/overview")).status, 403, "admin rolü göremez");
      assertEqual((await panel("/site-stats/live")).status, 403, "canlı liste de kapalı");
      await pool.query(`UPDATE users SET role = 'owner' WHERE username = $1`, [admin.username]);
    }

    step("Panel: özet ve canlı liste");
    {
      assertEqual((await panel("/site-stats/overview?period=yil")).status, 400, "bilinmeyen dönem 400");
      const o = await panel("/site-stats/overview?period=today");
      assertEqual(o.status, 200, "özet 200");
      const d = o.json.data;
      assert(d.totals.visitors >= 2, "en az iki ziyaretçi");
      assert(d.totals.pageviews >= 4, "en az dört sayfa görüntüleme");
      assertEqual(d.series.length, 7, "bugün döneminde de 7 günlük seri");
      assertEqual(d.series[6].day, todayKey(), "serinin son günü bugün");

      const kamp = d.pages.find((p: any) => p.path === "/smoke56/kamp");
      assertEqual(kamp?.title, "Smoke Kampı", "sayfa adı");
      assertEqual(kamp?.views, 2, "kamp sayfası iki kez açıldı");
      assertEqual(kamp?.sections.giris, 1, "fiyat bölümünü gören ziyaret");

      const video = d.ads.find((a: any) => a.campaign === `${P} Kamp` && a.content === "Video 2");
      assert(video !== undefined, "reklam satırı: Video 2");
      assertEqual(video.source, "instagram_ad", "reklamın kaynağı");
      assertEqual(video.visitors, 1, "reklamdan bir ziyaretçi");
      assertEqual(video.formOpen, 1, "formu açan");
      assertEqual(video.formStart, 1, "yazmaya başlayan");
      assertEqual(video.formSubmit, 0, "gönderim olayı yok");
      assertEqual(video.sections.giris, 1, "reklamdan gelip fiyatı gören");
      assertEqual(video.inquiries, 0, "bu reklamdan talep yok");
      const afis = d.ads.find((a: any) => a.campaign === `${P} Kamp` && a.content === "Afiş");
      assertEqual(afis?.inquiries, 1, "talep en son geldiği reklama yazıldı");

      const ig = d.sources.find((s: any) => s.source === "instagram_ad");
      assert(ig && ig.visitors >= 1 && ig.inquiries >= 1, "kaynak satırı: Instagram reklamı, talebiyle");
      const gpt = d.sources.find((s: any) => s.source === "chatgpt");
      assert(gpt && gpt.visitors >= 1, "kaynak satırı: ChatGPT");
      assert(d.forms.camp.open >= 1 && d.forms.camp.start >= 1, "form adımları");
      assert(d.totals.inquiriesByKind.camp >= 1, "gelen form sayısı");
      assertEqual(d.crawlers, null, "bot okumaları henüz yok");
      assertEqual(d.geo.attribution, "IP Geolocation by DB-IP", "veri kaynağı adı");
      assert(!JSON.stringify(d).includes("10.56."), "özette IP yok");

      const live = await panel("/site-stats/live");
      assertEqual(live.status, 200, "canlı liste 200");
      assert(live.json.data.count >= 1, "en az bir kişi sitede");
      assert(live.json.data.pages.some((p: any) => p.path === "/smoke56/dersler"), "canlı sayfa dökümü");

      const inquiry = await panel(`/site-inquiries/${inquiryId}`);
      assertEqual(inquiry.json?.data?.origin?.source, "instagram_ad", "talep detayında ziyaret özeti");
    }

    // ── 9. Bakım ─────────────────────────────────────────────────────────────
    step("Bakım: günlük özet yazılır, 90 günden eski ham satırlar silinir");
    {
      const old = await pool.query<{ id: string }>(
        `INSERT INTO site_visits (visitor_key, day, started_at, last_seen_at, source, device, entry_path)
         VALUES ('smoke56old', $1::date - 120, now() - interval '120 days', now() - interval '120 days', 'direct', 'phone', '/smoke56/eski')
         RETURNING id`,
        [todayKey()],
      );
      const yesterday = await pool.query<{ id: string }>(
        `INSERT INTO site_visits (visitor_key, day, started_at, last_seen_at, source, device, entry_path)
         VALUES ('smoke56dun', $1::date - 1, now() - interval '1 day', now() - interval '1 day', 'google', 'desktop', '/smoke56/dun')
         RETURNING id`,
        [todayKey()],
      );
      await pool.query(`INSERT INTO site_pageviews (visit_id, page_id, path, active_ms) VALUES ($1, $2, '/smoke56/dun', 5000)`, [
        yesterday.rows[0].id,
        pageId(),
      ]);
      await runSiteStatsMaintenance();
      const gone = await pool.query(`SELECT 1 FROM site_visits WHERE id = $1`, [old.rows[0].id]);
      assertEqual(gone.rows.length, 0, "120 günlük ziyaret silindi");
      const daily = await pool.query(
        `SELECT visitors, pageviews, active_ms::int AS active_ms FROM site_stats_daily
          WHERE day = $1::date - 1 AND dim = 'path' AND key = '/smoke56/dun'`,
        [todayKey()],
      );
      assertEqual(daily.rows.length, 1, "dünün sayfa özeti yazıldı");
      assertEqual(daily.rows[0].pageviews, 1, "özet: bir görüntüleme");
      assertEqual(daily.rows[0].active_ms, 5000, "özet: süre");
      await runSiteStatsMaintenance();
      const again = await pool.query(
        `SELECT count(*)::int AS n FROM site_stats_daily WHERE day = $1::date - 1 AND dim = 'path' AND key = '/smoke56/dun'`,
        [todayKey()],
      );
      assertEqual(again.rows[0].n, 1, "bakım tekrar çalışınca satır çoğalmaz");
    }

    step("Bakım: 1 yıldan eski talepler silinir, yenileri kalır");
    {
      const ins = (days: number) =>
        pool.query<{ id: string }>(
          `INSERT INTO site_inquiries (client_id, kind, full_name, phone, phone_key, created_at, notified_at)
           VALUES ($1, 'contact', $2, '0532 556 00 09', '5325560009', now() - make_interval(days => $3), now())
           RETURNING id`,
          [randomUUID(), `${P} Eski ${days}`, days],
        );
      const expired = await ins(400);
      const kept = await ins(300);
      await runSiteStatsMaintenance();
      const left = await pool.query(`SELECT id FROM site_inquiries WHERE id = ANY($1::bigint[])`, [[expired.rows[0].id, kept.rows[0].id]]);
      assertEqual(left.rows.map((r) => String(r.id)).join(","), String(kept.rows[0].id), "400 günlük talep silindi, 300 günlük duruyor");
      const fresh = await pool.query(`SELECT 1 FROM site_inquiries WHERE id = $1`, [inquiryId]);
      assertEqual(fresh.rows.length, 1, "bugünkü talep duruyor");
    }
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    if (session) await logout(session).catch(() => undefined);
    if (savedRole.rows[0]) await pool.query(`UPDATE users SET role = $2 WHERE id = $1`, [savedRole.rows[0].id, savedRole.rows[0].role]);
    if (savedSetting.rows[0]) {
      await pool.query(`UPDATE notification_settings SET enabled = $1 WHERE key = 'site_inquiry'`, [savedSetting.rows[0].enabled]);
    }
    await siteStatsIdle().catch(() => undefined);
    await cleanup().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
