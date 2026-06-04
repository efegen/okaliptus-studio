import { pool } from "../db/connection.js";
import {
  insertAuditLog,
  rollbackQuietly,
  normalizeMoneyInput,
  type MoneyInput,
} from "./shared.js";
import { AppError, StudentNotFoundError, toServiceError } from "./errors.js";

export type LessonTypeRow = {
  id: string;
  name: string;
  default_duration_minutes: number;
  default_price: string;
  currency: string;
  is_active: boolean;
};

export type LessonTypeStudentPriceRow = {
  lesson_type_id: string;
  student_id: string;
  full_name: string;
  nickname: string | null;
  custom_price: string;
  currency: string;
};

export async function listActiveLessonTypes(): Promise<LessonTypeRow[]> {
  const result = await pool.query<LessonTypeRow>(
    `
      SELECT id, name, default_duration_minutes, default_price, currency, is_active
      FROM lesson_types
      WHERE is_active AND deleted_at IS NULL
      ORDER BY id ASC
    `,
  );
  return result.rows;
}

export async function listAllLessonTypes(): Promise<LessonTypeRow[]> {
  const result = await pool.query<LessonTypeRow>(
    `
      SELECT id, name, default_duration_minutes, default_price, currency, is_active
      FROM lesson_types
      WHERE deleted_at IS NULL
      ORDER BY id ASC
    `,
  );
  return result.rows;
}

export async function createLessonType(
  input: {
    name: string;
    default_duration_minutes: number;
    default_price: number;
  },
  actorUserId?: number | string | null,
): Promise<LessonTypeRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<LessonTypeRow>(
      `
        INSERT INTO lesson_types (name, default_duration_minutes, default_price, currency)
        VALUES ($1, $2, $3, 'TRY')
        RETURNING id, name, default_duration_minutes, default_price, currency, is_active
      `,
      [input.name, input.default_duration_minutes, input.default_price],
    );
    const row = result.rows[0];
    await insertAuditLog(client, {
      action: "lesson_type_created",
      entityType: "lesson_type",
      entityId: row.id,
      after: row,
      actorUserId: actorUserId ?? null,
    });
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function updateLessonType(
  id: string,
  patch: {
    name?: string;
    default_duration_minutes?: number;
    default_price?: number;
    is_active?: boolean;
  },
  actorUserId?: number | string | null,
): Promise<LessonTypeRow | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (patch.name !== undefined) { setClauses.push(`name = $${idx++}`); values.push(patch.name); }
  if (patch.default_duration_minutes !== undefined) { setClauses.push(`default_duration_minutes = $${idx++}`); values.push(patch.default_duration_minutes); }
  if (patch.default_price !== undefined) { setClauses.push(`default_price = $${idx++}`); values.push(patch.default_price); }
  if (patch.is_active !== undefined) { setClauses.push(`is_active = $${idx++}`); values.push(patch.is_active); }

  if (setClauses.length === 0) return null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeResult = await client.query<LessonTypeRow>(
      `SELECT id, name, default_duration_minutes, default_price, currency, is_active
       FROM lesson_types WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id],
    );
    const before = beforeResult.rows[0];
    if (!before) {
      await client.query("COMMIT");
      return null;
    }

    values.push(id);
    const result = await client.query<LessonTypeRow>(
      `
        UPDATE lesson_types
        SET ${setClauses.join(", ")}
        WHERE id = $${idx} AND deleted_at IS NULL
        RETURNING id, name, default_duration_minutes, default_price, currency, is_active
      `,
      values,
    );
    const updated = result.rows[0] ?? null;

    if (updated) {
      await insertAuditLog(client, {
        action: "lesson_type_updated",
        entityType: "lesson_type",
        entityId: updated.id,
        before,
        after: updated,
        actorUserId: actorUserId ?? null,
      });
    }

    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Öğrenciye özel (sabit) ders fiyatı (migration 0238). Bir ders türünün
// varsayılan fiyatını belirli öğrenciler için ezer; custom_price = 0 ücretsiz
// demektir. createLesson, price_snapshot'ı bu override'dan (varsa) kopyalar.
// ───────────────────────────────────────────────────────────────────────────

export async function listLessonTypeStudentPrices(
  lessonTypeId: string,
): Promise<LessonTypeStudentPriceRow[]> {
  const result = await pool.query<LessonTypeStudentPriceRow>(
    `
      SELECT ltsp.lesson_type_id,
             ltsp.student_id,
             s.full_name,
             s.nickname,
             ltsp.custom_price,
             ltsp.currency
      FROM lesson_type_student_prices ltsp
      JOIN students s ON s.id = ltsp.student_id AND s.deleted_at IS NULL
      WHERE ltsp.lesson_type_id = $1
      ORDER BY lower(s.full_name), s.id
    `,
    [lessonTypeId],
  );
  return result.rows;
}

export async function setLessonTypeStudentPrice(
  lessonTypeId: string,
  studentId: string,
  customPrice: MoneyInput,
  actorUserId?: number | string | null,
): Promise<LessonTypeStudentPriceRow> {
  // Üst sınır yok (model "özel fiyat", default'tan yüksek olabilir); 0 = ücretsiz.
  const normalizedPrice = normalizeMoneyInput(customPrice, "custom_price", {
    allowZero: true,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lessonType = await client.query(
      `SELECT id FROM lesson_types WHERE id = $1 AND deleted_at IS NULL`,
      [lessonTypeId],
    );
    if (!lessonType.rows[0]) {
      throw new AppError("LESSON_TYPE_NOT_FOUND", "Ders türü bulunamadı.", 404);
    }

    const student = await client.query(
      `SELECT id FROM students WHERE id = $1 AND deleted_at IS NULL`,
      [studentId],
    );
    if (!student.rows[0]) {
      throw new StudentNotFoundError();
    }

    const beforeResult = await client.query<{ custom_price: string }>(
      `SELECT custom_price FROM lesson_type_student_prices
       WHERE lesson_type_id = $1 AND student_id = $2`,
      [lessonTypeId, studentId],
    );
    const before = beforeResult.rows[0] ?? null;

    await client.query(
      `
        INSERT INTO lesson_type_student_prices (lesson_type_id, student_id, custom_price, currency)
        VALUES ($1, $2, $3, 'TRY')
        ON CONFLICT (lesson_type_id, student_id)
        DO UPDATE SET custom_price = EXCLUDED.custom_price
      `,
      [lessonTypeId, studentId, normalizedPrice],
    );

    const rowResult = await client.query<LessonTypeStudentPriceRow>(
      `
        SELECT ltsp.lesson_type_id,
               ltsp.student_id,
               s.full_name,
               s.nickname,
               ltsp.custom_price,
               ltsp.currency
        FROM lesson_type_student_prices ltsp
        JOIN students s ON s.id = ltsp.student_id
        WHERE ltsp.lesson_type_id = $1 AND ltsp.student_id = $2
      `,
      [lessonTypeId, studentId],
    );
    const row = rowResult.rows[0];

    await insertAuditLog(client, {
      action: "lesson_type_student_price_set",
      entityType: "lesson_type_student_price",
      entityId: row.lesson_type_id,
      before,
      after: { student_id: row.student_id, custom_price: row.custom_price },
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
    return row;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function removeLessonTypeStudentPrice(
  lessonTypeId: string,
  studentId: string,
  actorUserId?: number | string | null,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query<{ custom_price: string }>(
      `DELETE FROM lesson_type_student_prices
       WHERE lesson_type_id = $1 AND student_id = $2
       RETURNING custom_price`,
      [lessonTypeId, studentId],
    );
    const removed = result.rows[0] ?? null;

    if (removed) {
      await insertAuditLog(client, {
        action: "lesson_type_student_price_removed",
        entityType: "lesson_type_student_price",
        entityId: lessonTypeId,
        before: { student_id: studentId, custom_price: removed.custom_price },
        actorUserId: actorUserId ?? null,
      });
    }

    await client.query("COMMIT");
    return removed !== null;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}
