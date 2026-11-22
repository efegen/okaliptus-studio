/**
 * SMOKE 55 — Gerçek ziyaretçi IP'si (Cloudflare geçişi)
 *
 * api.okaliptusyoga.com Cloudflare'de turuncu bulut (proxied) olursa req.ip
 * Cloudflare'in kenar IP'si olur. clientIp.ts bunu CF-Connecting-IP ile düzeltir,
 * ama YALNIZ istek Cloudflare aralığından geliyorsa.
 *
 * Senaryo:
 *   1. Aralık kontrolü: Cloudflare IPv4/IPv6 ve IPv4-mapped adresler tanınır,
 *      başka adresler tanınmaz.
 *   2. Cloudflare'den gelen istekler: farklı CF-Connecting-IP'ler ayrı kişi
 *      sayılır (6 gönderimin hiçbiri "burst" olmaz).
 *   3. Doğrudan gelen istek başlığı uyduramaz: aynı IP'den farklı
 *      CF-Connecting-IP'lerle gelen 6. gönderim yine "burst" olur.
 *
 * Ağ YOK, push YOK (site_inquiry türü test sırasında kapatılır).
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/55-client-ip.ts
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { isCloudflareIp } from "../../src/server/middleware/clientIp.js";
import { pool } from "../../src/db/connection.js";
import { section, step, assert, assertEqual, closePool } from "./_shared.js";

const P = "SMOKE55";

async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM site_inquiries WHERE full_name LIKE $1`, [P + "%"]);
}

async function run(): Promise<void> {
  const savedSetting = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM notification_settings WHERE key = 'site_inquiry'`,
  );
  await pool.query(`UPDATE notification_settings SET enabled = false WHERE key = 'site_inquiry'`);

  const server: Server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function send(hop: string, cfIp: string | null, n: number) {
    const clientId = randomUUID();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Origin: "https://www.okaliptusyoga.com",
      "X-Forwarded-For": hop,
    };
    if (cfIp) headers["CF-Connecting-IP"] = cfIp;
    const r = await fetch(base + "/public/inquiries", {
      method: "POST",
      headers,
      body: JSON.stringify({
        clientId,
        kind: "contact",
        name: `${P} Kişi ${n}`,
        phone: `0532 55 ${String(1000 + n)} 0`,
        elapsedMs: 9000,
        details: { topic: "diger", topicLabel: "Başka bir konu" },
      }),
    });
    const row = (await pool.query(`SELECT suspect_reason FROM site_inquiries WHERE client_id = $1`, [clientId])).rows[0];
    return { status: r.status, reason: row?.suspect_reason ?? null };
  }

  try {
    section("SMOKE 55 — Gerçek ziyaretçi IP'si (Cloudflare)");
    await cleanup();

    step("Cloudflare aralıkları");
    assert(isCloudflareIp("104.16.0.1"), "104.16.0.1 Cloudflare");
    assert(isCloudflareIp("172.64.12.34"), "172.64.12.34 Cloudflare");
    assert(isCloudflareIp("::ffff:162.158.1.1"), "IPv4-mapped Cloudflare");
    assert(isCloudflareIp("2606:4700::1111"), "2606:4700:: Cloudflare");
    assert(!isCloudflareIp("8.8.8.8"), "8.8.8.8 değil");
    assert(!isCloudflareIp("10.0.0.1"), "özel ağ değil");
    assert(!isCloudflareIp("2001:db8::1"), "başka IPv6 değil");
    assert(!isCloudflareIp(""), "boş değil");

    step("Cloudflare'den gelen farklı ziyaretçiler ayrı sayılır");
    for (let i = 0; i < 6; i++) {
      const r = await send("172.64.55.1", `203.0.113.${i + 1}`, i);
      assertEqual(r.status, 201, `ziyaretçi ${i + 1}: 201`);
      assertEqual(r.reason, null, `ziyaretçi ${i + 1}: şüpheli değil`);
    }

    step("Doğrudan gelen biri CF-Connecting-IP uyduramaz");
    const reasons: Array<string | null> = [];
    for (let i = 0; i < 6; i++) {
      const r = await send("198.51.100.77", `203.0.113.${100 + i}`, 10 + i);
      assertEqual(r.status, 201, `istek ${i + 1}: 201`);
      reasons.push(r.reason);
    }
    assert(reasons.slice(0, 5).every((x) => x === null), "ilk 5 temiz");
    assertEqual(reasons[5], "burst", "6. istek aynı IP sayılır: burst");
  } finally {
    if (savedSetting.rows[0]) {
      await pool.query(`UPDATE notification_settings SET enabled = $1 WHERE key = 'site_inquiry'`, [savedSetting.rows[0].enabled]);
    }
    await cleanup();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
