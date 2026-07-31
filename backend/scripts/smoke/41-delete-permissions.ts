/**
 * SMOKE 41 — Düzeltme (silme) yetki kapıları (v1.7)
 *
 * DELETE /payments/:id, /product-sales/:id, /packages/:id artık route-seviyesi
 * requireCan("*.delete") ile kapılı (owner/admin/instructor; assistant hariç).
 * Gerçek HTTP (createApp) üzerinden rol matrisi + 403 sonrası DB doğrulaması
 * (kapı mutasyonu gerçekten engelledi mi) + asistanın ödeme ALMA yetkisinin
 * korunduğu (regression) test edilir.
 *
 * Senaryolar:
 *   A. DELETE /payments/:id  — assistant 403 (+ hâlâ var), admin/instructor/owner 200.
 *   B. DELETE /product-sales/:id — assistant 403 (+ hâlâ var), admin/instructor/owner 200.
 *   C. DELETE /packages/:id  — assistant 403 (+ hâlâ var), admin/instructor/owner 200.
 *   D. Regression: assistant POST /payments/cash → 201 (ödeme ALMA hâlâ açık).
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/41-delete-permissions.ts
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { createUser } from "../../src/services/users.service.js";
import { createStudent } from "../../src/services/students.service.js";
import { createLesson, completeLesson } from "../../src/services/lessons.service.js";
import { createCashPayment } from "../../src/services/payments.service.js";
import { createProductSale } from "../../src/services/product-sales.service.js";
import { createPrepaidPackage } from "../../src/services/packages.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, assert, assertEqual, ok, fail, closePool, cleanupSmoke,
  seedAdminUser, nextSlotIso, isoNow, daysAgo, overrideDefaultLessonTypePrice,
} from "./_shared.js";

async function run(): Promise<void> {
  const admin = seedAdminUser();
  if (!admin) {
    section("SMOKE 41 — SKIPPED (BOOTSTRAP_ADMINS bulunamadı)");
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
  let studentId: string | null = null;
  const restorePrice = await overrideDefaultLessonTypePrice("1200");

  try {
    section("SMOKE 41 — Düzeltme (silme) yetki kapıları");

    // ── Setup: owner terfisi + admin/instructor/assistant kullanıcıları ─────────
    const seedRow = await pool.query<{ id: string; role: string }>(
      `SELECT id, role FROM users WHERE username = $1`, [admin.username],
    );
    if (!seedRow.rows[0]) { fail("Setup: seed admin satırı bulunamadı"); process.exit(1); }
    originalRole = seedRow.rows[0].role;
    ownerId = seedRow.rows[0].id;
    await pool.query(`UPDATE users SET role = 'owner' WHERE id = $1 AND role <> 'owner'`, [ownerId]);

    const tokenOwner = await login(admin.username, admin.password);
    if (!tokenOwner) { fail("Setup: owner login başarısız"); process.exit(1); }
    tokensToCleanup.push(tokenOwner);

    const adminUser = await createUser(
      { username: "smoke41_admin", displayName: "Smoke41 Admin", password: "Smoke41Admin1", role: "admin" }, ownerId,
    );
    createdUserIds.push(adminUser.id);
    const tokenAdmin = await login("smoke41_admin", "Smoke41Admin1");
    if (!tokenAdmin) { fail("Setup: admin login başarısız"); process.exit(1); }
    tokensToCleanup.push(tokenAdmin);

    const instructorUser = await createUser(
      { username: "smoke41_instructor", displayName: "Smoke41 Instructor", password: "Smoke41Inst1", role: "instructor" }, ownerId,
    );
    createdUserIds.push(instructorUser.id);
    const tokenInstructor = await login("smoke41_instructor", "Smoke41Inst1");
    if (!tokenInstructor) { fail("Setup: instructor login başarısız"); process.exit(1); }
    tokensToCleanup.push(tokenInstructor);

    const assistantUser = await createUser(
      { username: "smoke41_assistant", displayName: "Smoke41 Assistant", password: "Smoke41Assist1", role: "assistant" }, ownerId,
    );
    createdUserIds.push(assistantUser.id);
    const tokenAssistant = await login("smoke41_assistant", "Smoke41Assist1");
    if (!tokenAssistant) { fail("Setup: assistant login başarısız"); process.exit(1); }
    tokensToCleanup.push(tokenAssistant);

    const student = await createStudent({ fullName: "SMOKE41_main" });
    studentId = student.id;

    // ── A. DELETE /payments/:id ────────────────────────────────────────────────
    section("A — DELETE /payments/:id: assistant 403 (+hâlâ var), admin/instructor/owner 200");
    // Tek tamamlanmış ders (price 1200), 3 kısmi ödeme (300×3).
    const lessonA = await createLesson({ studentId: student.id, startsAt: nextSlotIso(), mode: "onsite" });
    await completeLesson(lessonA.id);
    const mkPay = async () => (await createCashPayment({
      targetType: "lesson", targetId: lessonA.id, amount: "300", source: "cash", paidAt: isoNow(),
    })).payment.id;
    const payX = await mkPay();
    const payY = await mkPay();
    const payZ = await mkPay();

    assertEqual((await req("DELETE", `/payments/${payX}`, { token: tokenAssistant })).status, 403, "A: assistant DELETE /payments/:id → 403");
    const payStill = await pool.query(`SELECT 1 FROM payments WHERE id = $1 AND deleted_at IS NULL`, [payX]);
    assert(payStill.rowCount === 1, "A: assistant reddedildikten sonra ödeme hâlâ mevcut");
    assertEqual((await req("DELETE", `/payments/${payX}`, { token: tokenAdmin })).status, 200, "A: admin DELETE /payments/:id → 200");
    assertEqual((await req("DELETE", `/payments/${payY}`, { token: tokenInstructor })).status, 200, "A: instructor DELETE /payments/:id → 200");
    assertEqual((await req("DELETE", `/payments/${payZ}`, { token: tokenOwner })).status, 200, "A: owner DELETE /payments/:id → 200");

    // ── B. DELETE /product-sales/:id ───────────────────────────────────────────
    section("B — DELETE /product-sales/:id: assistant 403 (+hâlâ var), admin/instructor/owner 200");
    const mkSale = async () => (await createProductSale({
      studentId: student.id, soldAt: daysAgo(1), totalAmount: "150", note: "SMK41",
    })).id;
    const saleX = await mkSale();
    const saleY = await mkSale();
    const saleZ = await mkSale();

    assertEqual((await req("DELETE", `/product-sales/${saleX}`, { token: tokenAssistant })).status, 403, "B: assistant DELETE /product-sales/:id → 403");
    const saleStill = await pool.query(`SELECT 1 FROM product_sales WHERE id = $1 AND deleted_at IS NULL`, [saleX]);
    assert(saleStill.rowCount === 1, "B: assistant reddedildikten sonra satış hâlâ mevcut");
    assertEqual((await req("DELETE", `/product-sales/${saleX}`, { token: tokenAdmin })).status, 200, "B: admin DELETE /product-sales/:id → 200");
    assertEqual((await req("DELETE", `/product-sales/${saleY}`, { token: tokenInstructor })).status, 200, "B: instructor DELETE /product-sales/:id → 200");
    assertEqual((await req("DELETE", `/product-sales/${saleZ}`, { token: tokenOwner })).status, 200, "B: owner DELETE /product-sales/:id → 200");

    // ── C. DELETE /packages/:id ────────────────────────────────────────────────
    section("C — DELETE /packages/:id: assistant 403 (+hâlâ var), admin/instructor/owner 200");
    // Taze paketler (kredi kullanılmamış) silinebilir; her biri kendi ödemesiyle.
    const mkPkg = async () => (await createPrepaidPackage({
      studentId: student.id, purchasedAt: daysAgo(1), creditCount: 4, unitPrice: "100", totalAmount: "400", source: "cash",
    })).prepaidPackage.id;
    const pkgX = await mkPkg();
    const pkgY = await mkPkg();
    const pkgZ = await mkPkg();

    assertEqual((await req("DELETE", `/packages/${pkgX}`, { token: tokenAssistant })).status, 403, "C: assistant DELETE /packages/:id → 403");
    const pkgStill = await pool.query(`SELECT 1 FROM prepaid_packages WHERE id = $1 AND deleted_at IS NULL`, [pkgX]);
    assert(pkgStill.rowCount === 1, "C: assistant reddedildikten sonra paket hâlâ mevcut");
    assertEqual((await req("DELETE", `/packages/${pkgX}`, { token: tokenAdmin })).status, 200, "C: admin DELETE /packages/:id → 200");
    assertEqual((await req("DELETE", `/packages/${pkgY}`, { token: tokenInstructor })).status, 200, "C: instructor DELETE /packages/:id → 200");
    assertEqual((await req("DELETE", `/packages/${pkgZ}`, { token: tokenOwner })).status, 200, "C: owner DELETE /packages/:id → 200");

    // ── D. Regression: assistant ödeme ALMA hâlâ açık ──────────────────────────
    // A'da 3 ödeme de silindi → lessonA'nın 1200 borcu geri döndü; onun üzerine
    // tahsilat yapılır (ayrı ders oluşturmaya gerek yok).
    section("D — Regression: assistant POST /payments/cash → 201 (ödeme alma korundu)");
    const collect = await req("POST", "/payments/cash", {
      token: tokenAssistant,
      body: { targetType: "lesson", targetId: lessonA.id, amount: "500", source: "cash", paidAt: isoNow() },
    });
    assertEqual(collect.status, 201, "D: assistant POST /payments/cash → 201 (silme kapısı ödeme almayı daraltmadı)");

    ok("\nSMOKE 41 — SİLME YETKİ KAPILARI TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    for (const token of tokensToCleanup) {
      await logout(token).catch(() => undefined);
    }
    if (studentId) {
      await cleanupSmoke([studentId]);
    }
    await restorePrice();
    if (createdUserIds.length > 0) {
      await pool.query(
        `DELETE FROM audit_logs WHERE entity_id = ANY($1::bigint[]) AND entity_type = 'user'`, [createdUserIds],
      ).catch(() => undefined);
      await pool.query(
        `DELETE FROM audit_logs WHERE actor_user_id = ANY($1::bigint[])`, [createdUserIds],
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

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
