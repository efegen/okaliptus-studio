import { pool } from "../db/connection.js";

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
