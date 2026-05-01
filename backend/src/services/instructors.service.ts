import { pool } from "../db/connection.js";
import { insertAuditLog, rollbackQuietly } from "./shared.js";
import { toServiceError } from "./errors.js";

export type InstructorRow = {
  id: string;
  full_name: string;
  is_active: boolean;
};

export async function listActiveInstructors(): Promise<InstructorRow[]> {
  const result = await pool.query<InstructorRow>(
    `
      SELECT id, full_name, is_active
      FROM instructors
      WHERE is_active AND deleted_at IS NULL
      ORDER BY id ASC
    `,
  );
  return result.rows;
}

export async function listAllInstructors(): Promise<InstructorRow[]> {
  const result = await pool.query<InstructorRow>(
    `
      SELECT id, full_name, is_active
      FROM instructors
      WHERE deleted_at IS NULL
      ORDER BY id ASC
    `,
  );
  return result.rows;
}

export async function createInstructor(
  input: { full_name: string },
  actorUserId?: number | string | null,
): Promise<InstructorRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<InstructorRow>(
      `
        INSERT INTO instructors (full_name)
        VALUES ($1)
        RETURNING id, full_name, is_active
      `,
      [input.full_name],
    );
    const row = result.rows[0];
    await insertAuditLog(client, {
      action: "instructor_created",
      entityType: "instructor",
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

export async function updateInstructor(
  id: string,
  patch: { full_name?: string; is_active?: boolean },
  actorUserId?: number | string | null,
): Promise<InstructorRow | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (patch.full_name !== undefined) {
    setClauses.push(`full_name = $${idx++}`);
    values.push(patch.full_name);
  }
  if (patch.is_active !== undefined) {
    setClauses.push(`is_active = $${idx++}`);
    values.push(patch.is_active);
  }

  if (setClauses.length === 0) return null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeResult = await client.query<InstructorRow>(
      `SELECT id, full_name, is_active
       FROM instructors WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id],
    );
    const before = beforeResult.rows[0];
    if (!before) {
      await client.query("COMMIT");
      return null;
    }

    values.push(id);
    const result = await client.query<InstructorRow>(
      `
        UPDATE instructors
        SET ${setClauses.join(", ")}
        WHERE id = $${idx} AND deleted_at IS NULL
        RETURNING id, full_name, is_active
      `,
      values,
    );
    const updated = result.rows[0] ?? null;

    if (updated) {
      await insertAuditLog(client, {
        action: "instructor_updated",
        entityType: "instructor",
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

export async function deleteInstructor(
  id: string,
  actorUserId?: number | string | null,
): Promise<InstructorRow | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeResult = await client.query<InstructorRow>(
      `SELECT id, full_name, is_active
       FROM instructors WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id],
    );
    const before = beforeResult.rows[0];
    if (!before) {
      await client.query("COMMIT");
      return null;
    }

    await client.query(
      `UPDATE instructors SET deleted_at = now() WHERE id = $1`,
      [id],
    );

    await insertAuditLog(client, {
      action: "instructor_deleted",
      entityType: "instructor",
      entityId: before.id,
      before,
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
    return before;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}
