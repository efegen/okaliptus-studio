import { pool } from "../db/connection.js";
import { insertAuditLog, rollbackQuietly } from "./shared.js";
import { toServiceError } from "./errors.js";

export type LessonTypeRow = {
  id: string;
  name: string;
  default_duration_minutes: number;
  default_price: string;
  currency: string;
  is_active: boolean;
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
