/**
 * SMOKE 14 — Auth (§2.14, v1.4)
 *
 * Servis katmanı (auth.service.ts) doğrudan test edilir; HTTP layer atlanır.
 * Bootstrap'ın oluşturduğu admin user kullanılır (BOOTSTRAP_ADMINS env).
 * Yoksa graceful skip.
 *
 * Senaryolar:
 *   A. Happy login → 64-char hex token; validateSession → AuthUser döner.
 *   B. Sliding expires_at — validateSession sonrası expires_at slide ediyor.
 *   C. Logout — sessions DELETE, validateSession null.
 *   D. Wrong password → null.
 *   E. Password length 6 sınırı (5 char null, 6 char OK).
 *   F. Inactive user → null (cleanup ile is_active=true).
 *   G. Invalid token (boş, rastgele) → null.
 *   H. Expired session (Direct SQL ile expires_at geriye al) → null.
 *   I. Non-existent username → null (timing protection).
 *   J. Bcrypt cost=12 doğrulaması (password_hash prefix kontrolü).
 *   K. Auth audit YOK — login/logout sonrası audit_logs'ta auth action'ı yok.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/14-auth.ts
 */

import { login, logout, validateSession } from "../../src/services/auth.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  step,
  info,
  assert,
  assertEqual,
  ok,
  fail,
  closePool,
  seedAdminUser,
  withinLastSeconds,
  diffSeconds,
} from "./_shared.js";

async function run(): Promise<void> {
  const admin = seedAdminUser();
  if (!admin) {
    section("SMOKE 14 — SKIPPED (BOOTSTRAP_ADMINS bulunamadı)");
    await closePool();
    return;
  }

  // Test sırasında oluşturulan token'ları biriktir; cleanup'ta sil.
  const tokensToCleanup: string[] = [];

  try {
    section("SMOKE 14 — Auth (login / session / logout)");

    // ─────────────────────────────────────────────────────────────────────────
    // A. Happy login
    // ─────────────────────────────────────────────────────────────────────────
    section("A — Happy login: token + validateSession AuthUser");

    const tokenA = await login(admin.username, admin.password);
    if (!tokenA) {
      fail("A: bootstrap admin ile login başarısız — şifre uyumsuz olabilir");
      process.exit(1);
    }
    tokensToCleanup.push(tokenA);
    info("token length", tokenA.length);
    assert(tokenA.length === 64, "A: token 64-char hex");
    assert(/^[0-9a-f]+$/.test(tokenA), "A: token sadece hex karakter");

    const userA = await validateSession(tokenA);
    assert(userA !== null, "A: validateSession non-null");
    if (userA) {
      assertEqual(typeof userA.id, "string", "A: AuthUser.id string");
      assertEqual(userA.username, admin.username, "A: AuthUser.username eşleşiyor");
      assert(typeof userA.displayName === "string", "A: AuthUser.displayName string");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // B. Sliding expires_at
    // ─────────────────────────────────────────────────────────────────────────
    section("B — Sliding window: validateSession expires_at'ı slide ediyor");

    const t0Res = await pool.query<{ expires_at: string }>(
      `SELECT expires_at FROM sessions WHERE token = $1`,
      [tokenA],
    );
    const t0 = t0Res.rows[0].expires_at;

    // 1.2 saniye bekle
    await new Promise(r => setTimeout(r, 1200));

    await validateSession(tokenA);

    const t1Res = await pool.query<{ expires_at: string }>(
      `SELECT expires_at FROM sessions WHERE token = $1`,
      [tokenA],
    );
    const t1 = t1Res.rows[0].expires_at;

    const slideSec = diffSeconds(t1, t0);
    assert(
      slideSec >= 0.5,
      `B: expires_at slide etti (Δ = ${slideSec.toFixed(2)}s)`,
    );
    // t1 ≈ now() + 30 gün; tolerance ±5sn
    const expectedExpiresAt = Date.now() + 30 * 86400 * 1000;
    const diffFromExpected = Math.abs(new Date(t1).getTime() - expectedExpiresAt) / 1000;
    assert(
      diffFromExpected < 5,
      `B: t1 ≈ now() + 30d (sapma ${diffFromExpected.toFixed(2)}s)`,
    );

    // ─────────────────────────────────────────────────────────────────────────
    // C. Logout
    // ─────────────────────────────────────────────────────────────────────────
    section("C — Logout: sessions DELETE, validateSession null");

    await logout(tokenA);
    const remainingC = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM sessions WHERE token = $1`,
      [tokenA],
    );
    assertEqual(remainingC.rows[0].c, "0", "C: session row silindi");
    const userAfterLogout = await validateSession(tokenA);
    assertEqual(userAfterLogout, null, "C: validateSession null");
    // tokenA artık ölü; cleanup listesinden çıkar
    tokensToCleanup.shift();

    // ─────────────────────────────────────────────────────────────────────────
    // D. Wrong password
    // ─────────────────────────────────────────────────────────────────────────
    section("D — Yanlış şifre: null + session yaratılmadı");

    const beforeD = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = $1)`,
      [admin.username],
    );
    const tokenD = await login(admin.username, "definitelyWrongPass!@#");
    assertEqual(tokenD, null, "D: yanlış şifre null döner");
    const afterD = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = $1)`,
      [admin.username],
    );
    assertEqual(beforeD.rows[0].c, afterD.rows[0].c, "D: session count değişmedi");

    // ─────────────────────────────────────────────────────────────────────────
    // E. Password length sınırı
    // ─────────────────────────────────────────────────────────────────────────
    section("E — Password min 6 char sınırı");

    const tokenShort = await login(admin.username, "short");
    assertEqual(tokenShort, null, "E: 5-char password null");
    // 6 char doğru password olmadığı için null bekleyemeyiz; sadece reddedilmediğini test edelim
    // (asıl 6+ kabul testi = happy path A)

    // ─────────────────────────────────────────────────────────────────────────
    // F. Inactive user
    // ─────────────────────────────────────────────────────────────────────────
    section("F — Inactive user login null");

    await pool.query(
      `UPDATE users SET is_active = false WHERE username = $1`,
      [admin.username],
    );
    try {
      const tokenF = await login(admin.username, admin.password);
      assertEqual(tokenF, null, "F: is_active=false → login null");
    } finally {
      // Cleanup: tekrar aktif et
      await pool.query(
        `UPDATE users SET is_active = true WHERE username = $1`,
        [admin.username],
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // G. Invalid token
    // ─────────────────────────────────────────────────────────────────────────
    section("G — Geçersiz token: null");

    const empty = await validateSession("");
    assertEqual(empty, null, "G: empty token null");
    const random = await validateSession("0".repeat(64));
    assertEqual(random, null, "G: random hex token null");
    const malformed = await validateSession("not-hex-at-all");
    assertEqual(malformed, null, "G: malformed token null");

    // ─────────────────────────────────────────────────────────────────────────
    // H. Expired session
    // ─────────────────────────────────────────────────────────────────────────
    section("H — Süresi geçmiş session: null");

    const tokenH = await login(admin.username, admin.password);
    if (!tokenH) {
      fail("H: login başarısız — testin kalanı atlandı");
    } else {
      tokensToCleanup.push(tokenH);
      // expires_at'ı 1 saat önce yap
      await pool.query(
        `UPDATE sessions SET expires_at = now() - interval '1 hour' WHERE token = $1`,
        [tokenH],
      );
      const userH = await validateSession(tokenH);
      assertEqual(userH, null, "H: expired session validateSession null");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // I. Non-existent username
    // ─────────────────────────────────────────────────────────────────────────
    section("I — Var olmayan username: null (timing protection)");

    const tokenI = await login("smoke14_nonexistent_user_xyz", "anything123");
    assertEqual(tokenI, null, "I: non-existent username null");

    // ─────────────────────────────────────────────────────────────────────────
    // J. Bcrypt cost=12
    // ─────────────────────────────────────────────────────────────────────────
    section("J — Bcrypt cost=12 prefix kontrolü");

    const hashRes = await pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE username = $1`,
      [admin.username],
    );
    const hash = hashRes.rows[0].password_hash;
    info("hash prefix", hash.slice(0, 7));
    assert(
      /^\$2[aby]\$12\$/.test(hash),
      `J: bcrypt cost=12 prefix beklendi, got ${hash.slice(0, 7)}`,
    );

    // ─────────────────────────────────────────────────────────────────────────
    // K. Auth audit YOK — v1.4 negatif assertion
    // ─────────────────────────────────────────────────────────────────────────
    section("K — Auth audit logging v1.4'te YOK (regression koruması)");

    const auditCount = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM audit_logs
        WHERE action IN ('user_login', 'user_logout', 'password_changed')`,
    );
    assertEqual(
      auditCount.rows[0].c,
      "0",
      "K: audit_logs'ta auth action'ı YOK (spec §2.14)",
    );

    ok("\nSMOKE 14 — AUTH TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    // Test sırasında oluşturulan canlı session'ları sil
    for (const token of tokensToCleanup) {
      await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]).catch(() => undefined);
    }
    await closePool();
  }
}

run().catch(err => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
