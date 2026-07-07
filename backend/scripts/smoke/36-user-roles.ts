/**
 * SMOKE 36 — RBAC Faz 1: rol altyapısı + kullanıcı yönetimi (migration 0255/0256)
 *
 * Bootstrap'ın oluşturduğu admin user kullanılır (BOOTSTRAP_ADMINS env); yoksa
 * graceful skip. Hem servis katmanı hem gerçek HTTP (createApp) çağrılır.
 *
 * Senaryolar:
 *   A. users_role_check: geçersiz rol INSERT reddedilir.
 *   B. Bootstrap owner terfisi (UPDATE … role='owner') + validateSession canlı rol.
 *   C. Owner createUser() ile kullanıcı yaratır; duplicate username → USERNAME_TAKEN.
 *   D. HTTP: assistant → GET /users 403 FORBIDDEN; owner → 200 ile liste.
 *   J. Push kapısı: assistant → GET /push/config 403; owner → 403 DEĞİL.
 *   E. Rol değişikliği mevcut oturuma yeniden girişsiz yansır (validateSession canlı okur).
 *   F. Pasifleştirme: sessions silinir, eski token/login geçersiz.
 *   G. Son-owner koruması: hedef sole owner + actor ≠ target → LAST_OWNER (servis katmanı,
 *      middleware'in ötesinde savunma; owner-only router'da actor≠target iken zaten ≥2 owner
 *      olması gerektiğinden HTTP'den tetiklenemez — bu yüzden doğrudan servis çağrısı).
 *   H. Kendini koruma: owner kendi hesabını HTTP'den pasifleştirir/düşürürse → SELF_UPDATE_FORBIDDEN.
 *   I. Şifre sıfırlama: eski şifre red, yeni şifre kabul; hedefin diğer oturumları düşer.
 *   K. Audit: her mutasyon ilgili action'ı yazar; before/after'da şifre materyali yok.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/36-user-roles.ts
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout, validateSession } from "../../src/services/auth.service.js";
import { createUser, updateUser } from "../../src/services/users.service.js";
import { LastOwnerError, UsernameTakenError } from "../../src/services/errors.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  info,
  assert,
  assertEqual,
  ok,
  fail,
  closePool,
  seedAdminUser,
} from "./_shared.js";

async function run(): Promise<void> {
  const admin = seedAdminUser();
  if (!admin) {
    section("SMOKE 36 — SKIPPED (BOOTSTRAP_ADMINS bulunamadı)");
    await closePool();
    return;
  }

  const server: Server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  async function req(
    method: string,
    path: string,
    opts: { token?: string | null; body?: unknown } = {},
  ): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Cookie = `session=${opts.token}`;
    const r = await fetch(base + path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let json: any = null;
    try { json = await r.json(); } catch { /* boş gövde */ }
    return { status: r.status, json };
  }

  const createdUserIds: string[] = [];
  const tokensToCleanup: string[] = [];
  let originalRole: string | null = null;
  let ownerId: string | null = null;

  try {
    section("SMOKE 36 — RBAC Faz 1 (rol altyapısı + kullanıcı yönetimi)");

    // ─────────────────────────────────────────────────────────────────────────
    // Setup: seed admin row + orijinal rol (cleanup'ta geri yüklenecek)
    // ─────────────────────────────────────────────────────────────────────────
    const seedRow = await pool.query<{ id: string; role: string }>(
      `SELECT id, role FROM users WHERE username = $1`,
      [admin.username],
    );
    if (!seedRow.rows[0]) {
      fail("Setup: seed admin satırı bulunamadı");
      process.exit(1);
    }
    originalRole = seedRow.rows[0].role;
    ownerId = seedRow.rows[0].id;

    // ─────────────────────────────────────────────────────────────────────────
    // A. users_role_check: geçersiz rol reddedilir
    // ─────────────────────────────────────────────────────────────────────────
    section("A — users_role_check: geçersiz rol INSERT reddedilir");

    let rejectedA = false;
    try {
      await pool.query(
        `INSERT INTO users (username, display_name, password_hash, role) VALUES ($1, 'x', 'x', 'bogus')`,
        ["smoke36_bogus_role"],
      );
    } catch {
      rejectedA = true;
    }
    assert(rejectedA, "A: geçersiz rol CHECK constraint tarafından reddedildi");
    const bogusCount = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM users WHERE username = $1`,
      ["smoke36_bogus_role"],
    );
    assertEqual(bogusCount.rows[0].c, "0", "A: bogus rol satırı oluşmadı");

    // ─────────────────────────────────────────────────────────────────────────
    // B. Bootstrap owner terfisi + validateSession canlı rol
    // ─────────────────────────────────────────────────────────────────────────
    section("B — Owner terfisi (bootstrap UPDATE kalıbı) + canlı rol okuma");

    const promote = await pool.query<{ id: string }>(
      `UPDATE users SET role = 'owner' WHERE id = $1 AND role <> 'owner' RETURNING id`,
      [ownerId],
    );
    info("promoted", promote.rowCount ?? 0);

    const tokenOwner = await login(admin.username, admin.password);
    if (!tokenOwner) {
      fail("B: owner login başarısız");
      process.exit(1);
    }
    tokensToCleanup.push(tokenOwner);
    const ownerUser = await validateSession(tokenOwner);
    assert(ownerUser !== null, "B: validateSession non-null");
    assertEqual(ownerUser?.role, "owner", "B: validateSession canlı rol = owner");

    // ─────────────────────────────────────────────────────────────────────────
    // C. Owner createUser() ile kullanıcı yaratır; duplicate username reddedilir
    // ─────────────────────────────────────────────────────────────────────────
    section("C — createUser(): admin + assistant kullanıcıları");

    const adminPasswordOld = "Smoke36AdminOld1";
    const adminUsername = "smoke36_admin";
    const assistantUsername = "smoke36_assistant";
    const assistantPassword = "Smoke36Assist1";

    const createdAdmin = await createUser(
      { username: adminUsername, displayName: "Smoke36 Admin", password: adminPasswordOld, role: "admin" },
      ownerId,
    );
    createdUserIds.push(createdAdmin.id);
    assertEqual(createdAdmin.role, "admin", "C: yeni kullanıcı rolü admin");

    const createdAssistant = await createUser(
      { username: assistantUsername, displayName: "Smoke36 Assistant", password: assistantPassword, role: "assistant" },
      ownerId,
    );
    createdUserIds.push(createdAssistant.id);
    assertEqual(createdAssistant.role, "assistant", "C: yeni kullanıcı rolü assistant");

    let duplicateRejected = false;
    try {
      await createUser(
        { username: adminUsername, displayName: "Duplicate", password: "AnotherPass1", role: "admin" },
        ownerId,
      );
    } catch (err) {
      duplicateRejected = err instanceof UsernameTakenError;
    }
    assert(duplicateRejected, "C: duplicate username → UsernameTakenError");

    // Login ile AuthUser.role doğrulaması + sonraki testler için token'lar
    const tokenAdmin = await login(adminUsername, adminPasswordOld);
    if (!tokenAdmin) { fail("C: smoke36_admin login başarısız"); process.exit(1); }
    tokensToCleanup.push(tokenAdmin);
    const adminAuthUser = await validateSession(tokenAdmin);
    assertEqual(adminAuthUser?.role, "admin", "C: smoke36_admin AuthUser.role = admin");

    const tokenAssistant = await login(assistantUsername, assistantPassword);
    if (!tokenAssistant) { fail("C: smoke36_assistant login başarısız"); process.exit(1); }
    tokensToCleanup.push(tokenAssistant);
    const assistantAuthUser = await validateSession(tokenAssistant);
    assertEqual(assistantAuthUser?.role, "assistant", "C: smoke36_assistant AuthUser.role = assistant");

    // ─────────────────────────────────────────────────────────────────────────
    // D. HTTP: /users yalnız owner'a açık
    // ─────────────────────────────────────────────────────────────────────────
    section("D — HTTP GET /users: assistant 403, owner 200");

    const dForbidden = await req("GET", "/users", { token: tokenAssistant });
    assertEqual(dForbidden.status, 403, "D: assistant → 403");
    assertEqual(dForbidden.json?.error?.code, "FORBIDDEN", "D: error.code = FORBIDDEN");

    const dOk = await req("GET", "/users", { token: tokenOwner });
    assertEqual(dOk.status, 200, "D: owner → 200");
    assert(Array.isArray(dOk.json?.data), "D: data dizi");
    const listedIds = (dOk.json.data as Array<{ id: string }>).map(u => String(u.id));
    assert(listedIds.includes(String(createdAdmin.id)), "D: liste smoke36_admin içeriyor");
    assert(listedIds.includes(String(createdAssistant.id)), "D: liste smoke36_assistant içeriyor");

    // ─────────────────────────────────────────────────────────────────────────
    // J. Push kapısı: /config her role açık (Etap 4 — instructor abone olabilmeli),
    //    yalnız /test (deploy-test özelliği) owner'a kilitli.
    // ─────────────────────────────────────────────────────────────────────────
    section("J — Push kapısı: /config her role açık, /test yalnız owner");

    const jConfigAssistant = await req("GET", "/push/config", { token: tokenAssistant });
    assert(
      jConfigAssistant.status !== 403 && jConfigAssistant.status !== 401,
      `J: assistant → /push/config 403/401 DEĞİL (got ${jConfigAssistant.status})`,
    );

    const jConfigOwner = await req("GET", "/push/config", { token: tokenOwner });
    assert(
      jConfigOwner.status !== 403 && jConfigOwner.status !== 401,
      `J: owner → /push/config 403/401 DEĞİL (got ${jConfigOwner.status})`,
    );

    // /push/test: 403 middleware'den ÖNCE tetiklenir → gerçek gönderim asla
    // olmaz, güvenle çağrılabilir. Owner tarafını burada denemiyoruz — owner'ın
    // bu DB'de gerçek push_subscriptions satırı olabilir, gerçek cihaza
    // bildirim gitmesin diye yalnız reddi doğruluyoruz (requireCan zaten
    // /users testinde (D) owner-geçer tarafıyla kanıtlanmış aynı middleware).
    const jTestAssistant = await req("POST", "/push/test", { token: tokenAssistant, body: {} });
    assertEqual(jTestAssistant.status, 403, "J: assistant → /push/test 403");

    // ─────────────────────────────────────────────────────────────────────────
    // E. Rol değişikliği mevcut oturuma yeniden girişsiz yansır
    // ─────────────────────────────────────────────────────────────────────────
    section("E — Rol değişikliği canlı: yeniden giriş gerekmez");

    await updateUser(createdAdmin.id, { role: "instructor" }, ownerId);
    const adminAfterRoleChange = await validateSession(tokenAdmin);
    assertEqual(adminAfterRoleChange?.role, "instructor", "E: mevcut oturum yeni rolü (instructor) görüyor");

    // ─────────────────────────────────────────────────────────────────────────
    // F. Pasifleştirme: sessions silinir, eski token/login geçersiz
    // ─────────────────────────────────────────────────────────────────────────
    section("F — Pasifleştirme: oturum anında kapanır, login reddedilir");

    const fPatch = await req("PATCH", `/users/${createdAssistant.id}`, {
      token: tokenOwner,
      body: { isActive: false },
    });
    assertEqual(fPatch.status, 200, "F: PATCH isActive:false → 200");

    const remainingSessions = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM sessions WHERE user_id = $1`,
      [createdAssistant.id],
    );
    assertEqual(remainingSessions.rows[0].c, "0", "F: pasifleştirilen kullanıcının oturumları silindi");

    const assistantAfterDeactivate = await validateSession(tokenAssistant);
    assertEqual(assistantAfterDeactivate, null, "F: eski token artık geçersiz");
    // tokenAssistant zaten öldü; cleanup listesinden çıkar
    const idx = tokensToCleanup.indexOf(tokenAssistant);
    if (idx !== -1) tokensToCleanup.splice(idx, 1);

    const loginAfterDeactivate = await login(assistantUsername, assistantPassword);
    assertEqual(loginAfterDeactivate, null, "F: pasif kullanıcı login yapamaz");

    // ─────────────────────────────────────────────────────────────────────────
    // G. Son-owner koruması (servis katmanı savunması, actor ≠ target)
    // ─────────────────────────────────────────────────────────────────────────
    section("G — Son-owner koruması: sole owner'ı actor≠target ile değiştirmek 409");

    let lastOwnerOnDeactivate = false;
    try {
      await updateUser(ownerId, { isActive: false }, createdAdmin.id);
    } catch (err) {
      lastOwnerOnDeactivate = err instanceof LastOwnerError;
    }
    assert(lastOwnerOnDeactivate, "G: sole owner'ı pasifleştirme → LastOwnerError");

    let lastOwnerOnDemote = false;
    try {
      await updateUser(ownerId, { role: "admin" }, createdAdmin.id);
    } catch (err) {
      lastOwnerOnDemote = err instanceof LastOwnerError;
    }
    assert(lastOwnerOnDemote, "G: sole owner'ı düşürme → LastOwnerError");

    // ─────────────────────────────────────────────────────────────────────────
    // H. Kendini koruma (HTTP, owner kendi hesabında)
    // ─────────────────────────────────────────────────────────────────────────
    section("H — Kendini koruma: owner kendi hesabını HTTP'den değiştiremez");

    const hDeactivateSelf = await req("PATCH", `/users/${ownerId}`, {
      token: tokenOwner,
      body: { isActive: false },
    });
    assertEqual(hDeactivateSelf.status, 409, "H: kendini pasifleştirme → 409");
    assertEqual(hDeactivateSelf.json?.error?.code, "SELF_UPDATE_FORBIDDEN", "H: error.code = SELF_UPDATE_FORBIDDEN");

    const hDemoteSelf = await req("PATCH", `/users/${ownerId}`, {
      token: tokenOwner,
      body: { role: "admin" },
    });
    assertEqual(hDemoteSelf.status, 409, "H: kendi rolünü düşürme → 409");
    assertEqual(hDemoteSelf.json?.error?.code, "SELF_UPDATE_FORBIDDEN", "H: error.code = SELF_UPDATE_FORBIDDEN");

    // ─────────────────────────────────────────────────────────────────────────
    // I. Şifre sıfırlama: eski red, yeni kabul; hedefin diğer oturumları düşer
    // ─────────────────────────────────────────────────────────────────────────
    section("I — Şifre sıfırlama: eski şifre red, yeni şifre kabul, oturum düşer");

    const adminPasswordNew = "Smoke36AdminNew1";
    const iPatch = await req("POST", `/users/${createdAdmin.id}/password`, {
      token: tokenOwner,
      body: { password: adminPasswordNew },
    });
    assertEqual(iPatch.status, 200, "I: şifre sıfırlama 200");

    const adminSessionAfterReset = await validateSession(tokenAdmin);
    assertEqual(adminSessionAfterReset, null, "I: hedefin eski oturumu düştü");
    const adminTokenIdx = tokensToCleanup.indexOf(tokenAdmin);
    if (adminTokenIdx !== -1) tokensToCleanup.splice(adminTokenIdx, 1);

    const loginOldPassword = await login(adminUsername, adminPasswordOld);
    assertEqual(loginOldPassword, null, "I: eski şifre ile login reddedildi");

    const loginNewPassword = await login(adminUsername, adminPasswordNew);
    assert(typeof loginNewPassword === "string" && loginNewPassword.length === 64, "I: yeni şifre ile login başarılı");
    if (loginNewPassword) tokensToCleanup.push(loginNewPassword);

    // ─────────────────────────────────────────────────────────────────────────
    // K. Audit: mutasyonlar yazıldı, şifre materyali yok
    // ─────────────────────────────────────────────────────────────────────────
    section("K — Audit: kullanıcı mutasyonları yazıldı, şifre materyali yok");

    const auditRows = await pool.query<{ action: string; before: unknown; after: unknown }>(
      `SELECT action, before, after FROM audit_logs
       WHERE entity_type = 'user' AND entity_id = ANY($1::bigint[])`,
      [[createdAdmin.id, createdAssistant.id]],
    );
    const actions = auditRows.rows.map(r => r.action);
    assert(actions.includes("user_created"), "K: user_created yazıldı");
    assert(actions.includes("user_role_changed"), "K: user_role_changed yazıldı");
    assert(actions.includes("user_deactivated"), "K: user_deactivated yazıldı");
    assert(actions.includes("user_password_reset"), "K: user_password_reset yazıldı");

    const auditText = JSON.stringify(auditRows.rows);
    assert(!auditText.includes(adminPasswordOld), "K: eski şifre metni audit'te yok");
    assert(!auditText.includes(adminPasswordNew), "K: yeni şifre metni audit'te yok");
    assert(!/\$2[aby]\$/.test(auditText), "K: bcrypt hash audit'te yok");

    ok("\nSMOKE 36 — RBAC FAZ 1 TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    for (const token of tokensToCleanup) {
      await logout(token).catch(() => undefined);
    }
    if (createdUserIds.length > 0) {
      // users FK'si actor_user_id'de ON DELETE SET NULL — bu test kullanıcılarının
      // login/logout audit satırlarını (actor_user_id = onlar) ÖNCE silmezsek,
      // kullanıcı silindiğinde o satırlar NULL actor_user_id ile kalıcı kalır ve
      // smoke 14'ün "auth audit'te actor_user_id hep dolu" değişmezini kalıcı
      // olarak bozar (paylaşılan DB, smoke:reset olmadan asla düzelmez).
      await pool.query(
        `DELETE FROM audit_logs WHERE entity_id = ANY($1::bigint[]) AND entity_type = 'user'`,
        [createdUserIds],
      ).catch(() => undefined);
      await pool.query(
        `DELETE FROM audit_logs WHERE actor_user_id = ANY($1::bigint[])`,
        [createdUserIds],
      ).catch(() => undefined);
      await pool.query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [createdUserIds]).catch(() => undefined);
    }
    if (ownerId && originalRole) {
      await pool.query(`UPDATE users SET role = $1 WHERE id = $2`, [originalRole, ownerId]).catch(() => undefined);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

run().catch(err => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
