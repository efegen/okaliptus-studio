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
