/**
 * Shared helpers for all smoke test scripts.
 *
 * CLEANUP STRATEGY (bottom of this file):
 *   cleanupSmoke(studentIds) soft-deletes all data for the given student IDs in the correct
 *   cascade order. It runs inside a single transaction so the
 *   trg_block_package_payment_delete trigger can see the package soft-delete and allow the
 *   payment soft-delete in the same transaction.
 *
 * HOW TO RUN SCRIPTS:
 *   cd backend
 *   npx tsx scripts/smoke/01-student-lesson-basic.ts
 */

// env.ts calls dotenv.config() — importing connection.ts pulls in env.ts first.
import { pool } from "../../src/db/connection.js";

// ─── ANSI colours ─────────────────────────────────────────────────────────────

const G = "\x1b[32m"; // green
const R = "\x1b[31m"; // red
const Y = "\x1b[33m"; // yellow
const C = "\x1b[36m"; // cyan
const B = "\x1b[1m";  // bold
const X = "\x1b[0m";  // reset

// ─── Logging helpers ──────────────────────────────────────────────────────────

export function ok(msg: string): void {
  console.log(`  ${G}✓${X} ${msg}`);
}

export function fail(msg: string): void {
  console.error(`  ${R}✗${X} ${msg}`);
}

export function step(msg: string): void {
  console.log(`\n${C}→${X} ${msg}`);
}

export function section(title: string): void {
  console.log(`\n${B}${Y}━━━ ${title} ━━━${X}`);
}

export function info(label: string, value: unknown): void {
  console.log(`    ${B}${label}${X}: ${String(value)}`);
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

export function assert(condition: boolean, description: string): void {
  if (condition) {
    ok(description);
  } else {
    fail(`ASSERTION FAILED: ${description}`);
    process.exit(1);
  }
}

export function assertEqual<T>(
  actual: T,
  expected: T,
  description: string,
): void {
  if (actual === expected) {
    ok(`${description} → ${String(actual)}`);
  } else {
    fail(`ASSERTION FAILED: ${description}`);
    info("expected", String(expected));
    info("  actual", String(actual));
    process.exit(1);
  }
}

/** Asserts a numeric string equals expected value (ignores trailing zeros). */
export function assertMoney(
  actual: string,
  expected: string,
  description: string,
): void {
  const a = parseFloat(actual);
  const e = parseFloat(expected);
  if (Math.abs(a - e) < 0.001) {
    ok(`${description} → ${actual} TRY`);
  } else {
    fail(`ASSERTION FAILED: ${description}`);
    info("expected", `${expected} TRY`);
    info("  actual", `${actual} TRY`);
    process.exit(1);
  }
}

/** Calls fn, expects it to throw an AppError with the given code. */
export async function assertRejects(
  fn: () => Promise<unknown>,
  expectedCode: string,
  description: string,
): Promise<void> {
  try {
    await fn();
    fail(`EXPECTED REJECTION (${expectedCode}) but call succeeded: ${description}`);
    process.exit(1);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === expectedCode) {
      ok(`Correctly rejected [${expectedCode}]: ${description}`);
    } else {
      fail(`Wrong error for: ${description}`);
      info("expected code", expectedCode);
      info("  actual code", code ?? "(none)");
      info("      message", (err as Error).message ?? "");
      process.exit(1);
    }
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Soft-deletes all financial data belonging to the given student IDs.
 *
 * Order matters:
 *   1. non-package payments  — lesson / product_sale payments
 *   2. prepaid_packages      — soft-delete first so trigger allows payment delete
 *   3. package payments      — trigger sees package.deleted_at IS NOT NULL → allows
 *   4. lessons
 *   5. product_sales
 *   6. students
 *
 * Everything runs in one transaction so read-your-own-writes makes step 3 work.
 */
export async function cleanupSmoke(studentIds: string[]): Promise<void> {
  if (studentIds.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const sid of studentIds) {
      // 1. non-package payments
      await client.query(
        `UPDATE payments
            SET deleted_at = now()
          WHERE deleted_at IS NULL
            AND prepaid_package_id IS NULL
            AND (
              lesson_id IN (SELECT id FROM lessons WHERE student_id = $1)
              OR product_sale_id IN (SELECT id FROM product_sales WHERE student_id = $1)
            )`,
        [sid],
      );

      // 2. packages (must come before package payment delete — trigger reads this)
      await client.query(
        `UPDATE prepaid_packages
            SET deleted_at = now()
          WHERE student_id = $1 AND deleted_at IS NULL`,
        [sid],
      );

      // 3. package payments (trigger now sees package.deleted_at IS NOT NULL)
      await client.query(
        `UPDATE payments
            SET deleted_at = now()
          WHERE deleted_at IS NULL
            AND prepaid_package_id IN (
              SELECT id FROM prepaid_packages WHERE student_id = $1
            )`,
        [sid],
      );

      // 4. lessons
      await client.query(
        `UPDATE lessons
            SET deleted_at = now()
          WHERE student_id = $1 AND deleted_at IS NULL`,
        [sid],
      );

      // 5. product_sales
      await client.query(
        `UPDATE product_sales
            SET deleted_at = now()
          WHERE student_id = $1 AND deleted_at IS NULL`,
        [sid],
      );

      // 6. student
      await client.query(
        `UPDATE students
            SET deleted_at = now()
          WHERE id = $1 AND deleted_at IS NULL`,
        [sid],
      );
    }

    await client.query("COMMIT");
    console.log(`\n🗑️  Cleanup: soft-deleted all data for student IDs [${studentIds.join(", ")}]\n`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("⚠️  Cleanup failed:", err);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

/**
 * Temporarily override the default active lesson_type's default_price for a
 * smoke test. Returns a function that restores the original value. Lets each
 * smoke script pin the price it needs without polluting the DB across tests.
 */
export async function overrideDefaultLessonTypePrice(
  newPrice: string,
): Promise<() => Promise<void>> {
  const current = await pool.query<{ id: string; default_price: string }>(
    `SELECT id, default_price
       FROM lesson_types
      WHERE is_active AND deleted_at IS NULL
      ORDER BY id ASC
      LIMIT 1`,
  );
  const row = current.rows[0];
  if (!row) throw new Error("overrideDefaultLessonTypePrice: no active lesson_type found.");

  await pool.query(`UPDATE lesson_types SET default_price = $1 WHERE id = $2`, [
    newPrice,
    row.id,
  ]);

  return async () => {
    await pool.query(`UPDATE lesson_types SET default_price = $1 WHERE id = $2`, [
      row.default_price,
      row.id,
    ]);
  };
}

export function isoNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

// ─── Conflict-free starts_at slot generator ───────────────────────────────────

// Lessons.service.ts double-booking koruması (LessonConflictError) ile çakışmamak
// için her test, her ders için bu helper ile starts_at üretir. Process içi sayaç,
// her çağrıda 65 dakika geriye giden slot döner (60 dk default ders + 5 dk buffer).
// Cari haftanın içinde kalır → KPI testleri lesson'ı 'bu hafta' olarak görür.
// Spawn ile her test ayrı process: counter reset; önceki test'in lesson'ları
// soft-delete edildiği için conflict check (deleted_at IS NULL) bunları yok sayar.
let _slotIndex = 0;
export function nextSlotIso(): string {
  _slotIndex += 1;
  const offsetMs = _slotIndex * 65 * 60 * 1000;
  // Test başlangıcından kısa süre önce başla (-2 dk), her sonrakini 65 dk geriye al.
  return new Date(Date.now() - 2 * 60 * 1000 - offsetMs).toISOString();
}

// ─── Actor user lookup ────────────────────────────────────────────────────────

/**
 * Returns the id of the first active admin user (bootstrap-created).
 * Used when a test wants to set actor_user_id without hardcoding a value
 * that would violate the FK to users(id).
 */
export async function getActorUserId(): Promise<number | null> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE is_active = true ORDER BY id ASC LIMIT 1`,
  );
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

// ─── Audit log assertions ─────────────────────────────────────────────────────

type AuditAssertion = {
  action: string;
  entityType: string;
  entityId: string | number;
  expectActorUserId?: number | string | null;
  expectBeforeContains?: Record<string, unknown>;
  expectAfterContains?: Record<string, unknown>;
};

/**
 * Asserts that exactly one audit_logs row matches the given filter and that
 * before/after JSONB contain the expected subset. expectActorUserId compares
 * loosely (string === number coerced).
 */
export async function assertAuditLog(opts: AuditAssertion): Promise<void> {
  const rows = await pool.query<{
    id: string;
    actor_user_id: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>(
    `SELECT id, actor_user_id, before, after
       FROM audit_logs
      WHERE action = $1
        AND entity_type = $2
        AND entity_id = $3
      ORDER BY id DESC
      LIMIT 1`,
    [opts.action, opts.entityType, opts.entityId],
  );

  if (rows.rows.length === 0) {
    fail(`AUDIT MISSING: ${opts.action} on ${opts.entityType}#${opts.entityId}`);
    process.exit(1);
  }

  const row = rows.rows[0];

  if (opts.expectActorUserId !== undefined) {
    const expected = opts.expectActorUserId === null ? null : String(opts.expectActorUserId);
    const actual = row.actor_user_id === null ? null : String(row.actor_user_id);
    if (expected !== actual) {
      fail(`AUDIT actor_user_id mismatch on ${opts.action}: expected ${expected}, got ${actual}`);
      process.exit(1);
    }
  }

  if (opts.expectBeforeContains) {
    assertJsonContains(row.before ?? {}, opts.expectBeforeContains, `audit.before for ${opts.action}`);
  }
  if (opts.expectAfterContains) {
    assertJsonContains(row.after ?? {}, opts.expectAfterContains, `audit.after for ${opts.action}`);
  }

  ok(`audit ${opts.action} on ${opts.entityType}#${opts.entityId} ✓`);
}

function assertJsonContains(
  haystack: Record<string, unknown>,
  needle: Record<string, unknown>,
  description: string,
): void {
  for (const [key, expected] of Object.entries(needle)) {
    const actual = haystack[key];
    if (typeof expected === "string" && typeof actual === "string") {
      // Money/numeric tolerance for string-encoded decimals
      const ea = parseFloat(expected);
      const aa = parseFloat(actual);
      if (!Number.isNaN(ea) && !Number.isNaN(aa)) {
        if (Math.abs(ea - aa) >= 0.001) {
          fail(`${description}: ${key} expected ${expected}, got ${actual}`);
          process.exit(1);
        }
        continue;
      }
    }
    if (actual !== expected) {
      fail(`${description}: ${key} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      process.exit(1);
    }
  }
}

// ─── Direct SQL invariant assertions ──────────────────────────────────────────

/**
 * Runs a raw pool query and expects it to throw with a message containing the
 * given substring. Used for DB-level trigger and CHECK constraint tests where
 * AppError codes are not raised.
 */
export async function assertSqlRejects(
  sqlFn: () => Promise<unknown>,
  expectedMessageSubstring: string,
  description: string,
): Promise<void> {
  try {
    await sqlFn();
    fail(`EXPECTED SQL REJECTION but call succeeded: ${description}`);
    process.exit(1);
  } catch (err: unknown) {
    const message = (err as Error).message ?? String(err);
    if (message.includes(expectedMessageSubstring)) {
      ok(`Correctly rejected at DB level [${expectedMessageSubstring}]: ${description}`);
    } else {
      fail(`Wrong DB-level error for: ${description}`);
      info("expected substring", expectedMessageSubstring);
      info("  actual message", message);
      process.exit(1);
    }
  }
}

// ─── View row assertion ───────────────────────────────────────────────────────

/**
 * Looks up a single row from the given view by the where clause, asserts the
 * specified columns equal the expected values (numeric strings use money
 * tolerance, others strict ===).
 */
export async function assertViewRow(
  viewName: string,
  where: Record<string, string | number>,
  expected: Record<string, string | number | null>,
  description?: string,
): Promise<void> {
  const whereKeys = Object.keys(where);
  if (whereKeys.length === 0) throw new Error("assertViewRow: where must not be empty");

  const conditions = whereKeys.map((k, i) => `${k} = $${i + 1}`).join(" AND ");
  const values = whereKeys.map(k => where[k]);
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM ${viewName} WHERE ${conditions} LIMIT 1`,
    values,
  );

  const row = result.rows[0];
  if (!row) {
    fail(`assertViewRow: no row in ${viewName} matching ${JSON.stringify(where)}`);
    process.exit(1);
  }

  for (const [col, want] of Object.entries(expected)) {
    const got = row[col] as unknown;
    if (want === null) {
      if (got !== null) {
        fail(`${viewName}.${col} expected null, got ${String(got)}`);
        process.exit(1);
      }
      continue;
    }
    if (typeof want === "string" && typeof got === "string" && /^-?\d+(\.\d+)?$/.test(want)) {
      const a = parseFloat(got);
      const e = parseFloat(want);
      if (Math.abs(a - e) >= 0.001) {
        fail(`${viewName}.${col} expected ${want}, got ${got}`);
        process.exit(1);
      }
      continue;
    }
    if (String(got) !== String(want)) {
      fail(`${viewName}.${col} expected ${String(want)}, got ${String(got)}`);
      process.exit(1);
    }
  }

  ok(description ?? `${viewName} row matches expected values`);
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Reads BOOTSTRAP_ADMINS from the environment and returns the first admin's
 * { username, password } pair. Returns null with a warning if the env is
 * missing — auth tests should gracefully skip in that case.
 */
export function seedAdminUser(): { username: string; password: string } | null {
  const raw = process.env.BOOTSTRAP_ADMINS?.trim();
  if (!raw) {
    console.log(`  ${Y}⚠${X}  BOOTSTRAP_ADMINS not set — auth tests will skip`);
    return null;
  }
  const first = raw.split(",")[0];
  const colonIdx = first.indexOf(":");
  if (colonIdx === -1) return null;
  const username = first.slice(0, colonIdx).trim();
  const password = first.slice(colonIdx + 1).trim();
  if (!username || !password) return null;
  return { username, password };
}

/**
 * Returns true if the given timestamp is within `seconds` of now (absolute
 * difference). Used for sliding session expires_at checks.
 */
export function withinLastSeconds(timestamp: string | Date, seconds: number): boolean {
  const t = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp.getTime();
  return Math.abs(Date.now() - t) <= seconds * 1000;
}

/**
 * Parses two ISO timestamp strings and returns the absolute difference in
 * seconds. Used to verify sliding window updates.
 */
export function diffSeconds(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 1000;
}
