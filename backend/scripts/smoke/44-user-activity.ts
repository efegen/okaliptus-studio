/**
 * SMOKE 44 — Kullanıcı aktivite özeti (migration 0288)
 *
 * Ping: ilk etkileşim = 1 giriş, 15 dk içinde tekrar = aynı giriş, 15 dk'dan
 * uzun ara sonrası = yeni giriş. Liste: çevrimiçi/bugünkü sayı. HTTP kapısı:
 * ping tüm rollere açık, GET /users/activity yalnız owner.
 *
 * ÇALIŞTIRMA: cd backend && npx tsx scripts/smoke/44-user-activity.ts
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { createUser } from "../../src/services/users.service.js";
import { recordActivity, listUserActivity } from "../../src/services/user-activity.service.js";
import { pool } from "../../src/db/connection.js";
import { section, assert, assertEqual, ok, fail, closePool, seedAdminUser } from "./_shared.js";

async function run(): Promise<void> {
  const admin = seedAdminUser();
  if (!admin) {
    section("SMOKE 44 — SKIPPED (BOOTSTRAP_ADMINS bulunamadı)");
    await closePool();
    return;
  }

  const server: Server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function req(method: string, path: string, token: string) {
    const r = await fetch(base + path, { method, headers: { Cookie: `session=${token}` } });
    let json: any = null;
    try { json = await r.json(); } catch { /* 204 */ }
    return { status: r.status, json };
  }

  const createdUserIds: string[] = [];
  const tokens: string[] = [];
  let ownerId: string | null = null;

  try {
    section("SMOKE 44 — Kullanıcı aktivitesi");
    const ownerRow = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [admin.username]);
    ownerId = ownerRow.rows[0]?.id ?? null;
    if (!ownerId) { fail("owner satırı yok"); process.exit(1); }

    const u = await createUser(
      { username: "smoke44_assistant", displayName: "S44 Assistant", password: "Smoke44Assist1", role: "assistant" }, ownerId);
    createdUserIds.push(u.id);

    const count = async () => (await listUserActivity()).find((a) => a.userId === String(u.id));

    section("A — ilk ping = 1 giriş, hemen ardından tekrar = aynı giriş");
    await recordActivity(u.id);
    await recordActivity(u.id);
    assertEqual((await count())?.todaySessions, 1, "A: iki hızlı ping → 1 giriş");
    assertEqual((await count())?.todaySeconds, 30, "A: süre = ilk ping kredisi (30 sn)");
    assert((await count())?.todayFirstAt != null, "A: ilk etkileşim zamanı var");
    assertEqual((await count())?.isOnline, true, "A: çevrimiçi");

    section("B — 15 dk'dan uzun ara sonrası yeni giriş");
    await pool.query(`UPDATE user_activity_days SET last_active_at = now() - interval '20 minutes' WHERE user_id = $1`, [u.id]);
    assertEqual((await count())?.isOnline, false, "B: 20 dk önce → çevrimiçi değil");
    await recordActivity(u.id);
    assertEqual((await count())?.todaySessions, 2, "B: yeni giriş → 2");
    assertEqual((await count())?.todaySeconds, 60, "B: yeni giriş +30 sn");

    section("C — 15 dk'dan kısa ara aynı giriş");
    await pool.query(`UPDATE user_activity_days SET last_active_at = now() - interval '10 minutes' WHERE user_id = $1`, [u.id]);
    await recordActivity(u.id);
    assertEqual((await count())?.todaySessions, 2, "C: 10 dk ara → hâlâ 2");
    assertEqual((await count())?.todaySeconds, 150, "C: aynı giriş içi ping en çok +90 sn");
    assert(((await count())?.history.length ?? 0) === 1, "C: history'de bugün var");

    section("D — HTTP kapıları");
    const tokenAsst = await login("smoke44_assistant", "Smoke44Assist1");
    const tokenOwner = await login(admin.username, admin.password);
    if (!tokenAsst || !tokenOwner) { fail("D: login başarısız"); process.exit(1); }
    tokens.push(tokenAsst, tokenOwner);
    assertEqual((await req("POST", "/activity/ping", tokenAsst)).status, 204, "D: assistant ping → 204");
    assertEqual((await req("GET", "/users/activity", tokenAsst)).status, 403, "D: assistant GET → 403");
    const g = await req("GET", "/users/activity", tokenOwner);
    assertEqual(g.status, 200, "D: owner GET → 200");
    assert(Array.isArray(g.json?.data), "D: data dizi");

    ok("\nSMOKE 44 — KULLANICI AKTİVİTESİ TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    for (const t of tokens) await logout(t).catch(() => undefined);
    if (createdUserIds.length > 0) {
      await pool.query(`DELETE FROM audit_logs WHERE entity_id = ANY($1::bigint[]) AND entity_type='user'`, [createdUserIds]).catch(() => undefined);
      await pool.query(`DELETE FROM audit_logs WHERE actor_user_id = ANY($1::bigint[])`, [createdUserIds]).catch(() => undefined);
      await pool.query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [createdUserIds]).catch(() => undefined);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
