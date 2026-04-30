import { pool } from "../db/connection.js";

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

export async function createLessonType(input: {
  name: string;
  default_duration_minutes: number;
  default_price: number;
}): Promise<LessonTypeRow> {
  const result = await pool.query<LessonTypeRow>(
    `
      INSERT INTO lesson_types (name, default_duration_minutes, default_price, currency)
      VALUES ($1, $2, $3, 'TRY')
      RETURNING id, name, default_duration_minutes, default_price, currency, is_active
    `,
    [input.name, input.default_duration_minutes, input.default_price],
  );
  return result.rows[0];
}

export async function updateLessonType(
  id: string,
  patch: {
    name?: string;
    default_duration_minutes?: number;
    default_price?: number;
    is_active?: boolean;
  },
): Promise<LessonTypeRow | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (patch.name !== undefined) { setClauses.push(`name = $${idx++}`); values.push(patch.name); }
  if (patch.default_duration_minutes !== undefined) { setClauses.push(`default_duration_minutes = $${idx++}`); values.push(patch.default_duration_minutes); }
  if (patch.default_price !== undefined) { setClauses.push(`default_price = $${idx++}`); values.push(patch.default_price); }
  if (patch.is_active !== undefined) { setClauses.push(`is_active = $${idx++}`); values.push(patch.is_active); }

  if (setClauses.length === 0) return null;

  values.push(id);
  const result = await pool.query<LessonTypeRow>(
    `
      UPDATE lesson_types
      SET ${setClauses.join(", ")}
      WHERE id = $${idx} AND deleted_at IS NULL
      RETURNING id, name, default_duration_minutes, default_price, currency, is_active
    `,
    values,
  );
  return result.rows[0] ?? null;
}
