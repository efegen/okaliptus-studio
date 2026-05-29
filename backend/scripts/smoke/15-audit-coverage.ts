/**
 * SMOKE 15 — Audit Coverage (v1.4)
 *
 * Senaryolar:
 *   A. createLessonType → audit lesson_type_created (actor=99, after içerir)
 *   B. updateLessonType (default_price 750→800) → lesson_type_updated, before/after diff
 *   C. updateSettings(weeklyCapacity) → settings_updated, before/after diff
 *   D. POZİTİF — auth audit VAR: login + logout sonrası audit_logs'a
 *      user_login/user_logout yazılır (güvenlik denetimi, migration 0236)
 *
 * Cleanup:
 *   - Test'te oluşturulan lesson_type'ı is_active=false yap (referansı var olabilir)
 *   - Settings'i baştaki haline döndür
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/15-audit-coverage.ts
 */

import { createLessonType, updateLessonType } from "../../src/services/lesson-types.service.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import { login, logout, validateSession } from "../../src/services/auth.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  step,
  info,
  assert,
  assertEqual,
  assertAuditLog,
  ok,
  closePool,
  seedAdminUser,
  getActorUserId,
} from "./_shared.js";

async function run(): Promise<void> {
  let createdTypeId: string | null = null;
  let initialCapacity: number | null = null;
  const ACTOR = await getActorUserId();
  if (ACTOR === null) {
    throw new Error("SMOKE 15: bootstrap admin yok — testler için actor gerekli");
  }

  try {
    section("SMOKE 15 — Audit Coverage (v1.4)");

    // ─────────────────────────────────────────────────────────────────────────
    // A. createLessonType
    // ─────────────────────────────────────────────────────────────────────────
    section("A — createLessonType → lesson_type_created audit");

    const created = await createLessonType(
      {
        name: `SMOKE15_TYPE_${Date.now()}`,
        default_duration_minutes: 60,
        default_price: 750,
      },
      ACTOR,
    );
    createdTypeId = created.id;
    info("created.id", created.id);
    info("created.name", created.name);

    await assertAuditLog({
      action: "lesson_type_created",
      entityType: "lesson_type",
      entityId: created.id,
      expectActorUserId: ACTOR,
      expectAfterContains: { default_price: "750", default_duration_minutes: 60 },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // B. updateLessonType (default_price 750→800)
    // ─────────────────────────────────────────────────────────────────────────
    section("B — updateLessonType (price 750→800) → lesson_type_updated");

    await updateLessonType(created.id, { default_price: 800 }, ACTOR);

    await assertAuditLog({
      action: "lesson_type_updated",
      entityType: "lesson_type",
      entityId: created.id,
      expectActorUserId: ACTOR,
      expectBeforeContains: { default_price: "750" },
      expectAfterContains: { default_price: "800" },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // C. updateSettings(weeklyCapacity) → settings_updated
    // ─────────────────────────────────────────────────────────────────────────
    section("C — updateSettings(weeklyCapacity) → settings_updated");

    const before = await getSettings();
    initialCapacity = before.weeklyCapacity;
    info("initial weeklyCapacity", initialCapacity);

    const newCapacity = initialCapacity === 50 ? 60 : 50;
    await updateSettings({ weeklyCapacity: newCapacity }, ACTOR);

    await assertAuditLog({
      action: "settings_updated",
      entityType: "settings",
      entityId: 1,
      expectActorUserId: ACTOR,
      expectBeforeContains: { weeklyCapacity: initialCapacity },
      expectAfterContains: { weeklyCapacity: newCapacity },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // D. POZİTİF — auth audit VAR (güvenlik denetimi, migration 0236)
    // ─────────────────────────────────────────────────────────────────────────
    section("D — POZİTİF: login/logout audit_logs'a yazılıyor");

    const admin = seedAdminUser();
    if (admin) {
      const beforeAuthCount = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM audit_logs
          WHERE action IN ('user_login', 'user_logout')`,
      );

      const token = await login(admin.username, admin.password, "203.0.113.7");
      if (token) {
        await validateSession(token);
        await logout(token, "203.0.113.7");
      }

      const afterAuthCount = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM audit_logs
          WHERE action IN ('user_login', 'user_logout')`,
      );

      assertEqual(
        Number(afterAuthCount.rows[0].c) - Number(beforeAuthCount.rows[0].c),
        2,
        "D: login + logout = 2 yeni auth audit kaydı (user_login + user_logout)",
      );
    } else {
      info("D", "BOOTSTRAP_ADMINS yok — auth audit pozitif testi atlandı");
    }

    ok("\nSMOKE 15 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    // Cleanup: settings'i geri al
    if (initialCapacity !== null) {
      try {
        await updateSettings({ weeklyCapacity: initialCapacity }, ACTOR);
      } catch {
        // ignore
      }
    }
    // Cleanup: oluşturulan lesson_type'ı pasifleştir (silmek FK referansı olabilir)
    if (createdTypeId) {
      try {
        await updateLessonType(createdTypeId, { is_active: false }, ACTOR);
      } catch {
        // ignore
      }
    }
    await closePool();
  }
}

run().catch(err => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
