import { pool } from "../db/connection.js";
import {
  DeleteConflictError,
  StudentNotFoundError,
  ValidationError,
  toServiceError,
} from "./errors.js";
import {
  assertTryCurrency,
  insertAuditLog,
  normalizeOptionalText,
  normalizeRequiredText,
  rollbackQuietly,
  type EntityId,
} from "./shared.js";

export type LessonMode = "online" | "onsite";

function normalizePreferredMode(value: unknown): LessonMode | null {
  if (value === null || value === undefined || value === "") return null;
  if (value === "online" || value === "onsite") return value;
  throw new ValidationError("preferredMode must be 'online', 'onsite', or null.");
}

type StudentRow = {
  id: string;
  full_name: string;
  nickname: string | null;
  preferred_mode: LessonMode | null;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  joined_at: string | null;
  note: string | null;
  currency: string;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type StudentSummaryRow = {
  id: string;
  full_name: string;
  nickname: string | null;
  preferred_mode: LessonMode | null;
  phone: string | null;
  is_active: boolean;
  lesson_debt: string;
  product_debt: string;
  active_credit_value: string;
  remaining_credits: string;
  last_lesson_at: string | null;
  lessons_last_30_days: string;
};

export type CreateStudentInput = {
  fullName: string;
  nickname?: string | null;
  preferredMode?: LessonMode | null;
  phone?: string | null;
  email?: string | null;
  birthday?: string | null;
  joinedAt?: string | null;
  note?: string | null;
  currency?: string;
  isActive?: boolean;
};

export type UpdateStudentInput = {
  fullName?: string;
  nickname?: string | null;
  preferredMode?: LessonMode | null;
  phone?: string | null;
  email?: string | null;
  birthday?: string | null;
  joinedAt?: string | null;
  note?: string | null;
  currency?: string;
  isActive?: boolean;
};

export async function listStudents(): Promise<StudentSummaryRow[]> {
  const result = await pool.query<StudentSummaryRow>(
    `
      SELECT v.*, s.phone,
        att.last_lesson_at,
        att.lessons_last_30_days
      FROM v_student_summary v
      JOIN students s ON s.id = v.id
      CROSS JOIN LATERAL (
        SELECT
          MAX(l.starts_at) AS last_lesson_at,
          COUNT(*) FILTER (
            WHERE l.starts_at >= now() - interval '30 days'
          ) AS lessons_last_30_days
        FROM lessons l
        WHERE l.student_id = s.id
          AND l.status = 'completed'
          AND l.deleted_at IS NULL
      ) att
      ORDER BY lower(v.full_name), v.id
    `,
  );

  return result.rows;
}

export async function getStudentById(studentId: EntityId): Promise<StudentRow> {
  const result = await pool.query<StudentRow>(
    `
      SELECT *
      FROM students
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [studentId],
  );

  const student = result.rows[0];

  if (!student) {
    throw new StudentNotFoundError();
  }

  return student;
}

export async function getStudentSummary(studentId: EntityId): Promise<StudentSummaryRow> {
  const result = await pool.query<StudentSummaryRow>(
    `
      SELECT *
      FROM v_student_summary
      WHERE id = $1
    `,
    [studentId],
  );

  const summary = result.rows[0];

  if (!summary) {
    throw new StudentNotFoundError();
  }

  return summary;
}

type DebtorRow = {
  student_id: string;
  full_name: string;
  lesson_debt: string;
  product_debt: string;
  total_debt: string;
  oldest_debt_since: string | null;
};

export async function listDebtors(): Promise<DebtorRow[]> {
  const result = await pool.query<DebtorRow>(`
    SELECT
      ss.id                                    AS student_id,
      ss.full_name,
      ss.lesson_debt,
      ss.product_debt,
      (ss.lesson_debt + ss.product_debt)::text AS total_debt,
      LEAST(
        COALESCE(
          (SELECT MIN(lb.starts_at)
           FROM v_lesson_balances lb
           WHERE lb.student_id = ss.id
             AND lb.remaining_receivable > 0.01
             AND lb.status = 'completed'
             AND lb.prepaid_package_id IS NULL),
          'infinity'::timestamptz
        ),
        COALESCE(
          (SELECT MIN(pb.sold_at)
           FROM v_product_sale_balances pb
           WHERE pb.student_id = ss.id
             AND pb.remaining_receivable > 0.01),
          'infinity'::timestamptz
        )
      )::text AS oldest_debt_since
    FROM v_student_summary ss
    WHERE (ss.lesson_debt + ss.product_debt) > 0.01
    ORDER BY (ss.lesson_debt + ss.product_debt) DESC
  `);

  return result.rows;
}

export async function createStudent(input: CreateStudentInput): Promise<StudentRow> {
  const client = await pool.connect();

  try {
    const fullName = normalizeRequiredText(input.fullName, "fullName");
    const currency = input.currency ?? "TRY";

    assertTryCurrency(currency);

    await client.query("BEGIN");

    const insertResult = await client.query<StudentRow>(
      `
        INSERT INTO students (
          full_name,
          nickname,
          preferred_mode,
          phone,
          email,
          birthday,
          joined_at,
          note,
          currency,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        fullName,
        normalizeOptionalText(input.nickname),
        normalizePreferredMode(input.preferredMode),
        normalizeOptionalText(input.phone),
        normalizeOptionalText(input.email),
        input.birthday ?? null,
        input.joinedAt ?? null,
        normalizeOptionalText(input.note),
        currency,
        input.isActive ?? true,
      ],
    );

    const student = insertResult.rows[0];

    await insertAuditLog(client, {
      action: "student_created",
      entityType: "student",
      entityId: student.id,
      after: student,
    });

    await client.query("COMMIT");
    return student;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function updateStudent(
  studentId: EntityId,
  input: UpdateStudentInput,
): Promise<StudentRow> {
  const client = await pool.connect();

  try {
    if (Object.keys(input).length === 0) {
      throw new ValidationError("At least one field is required to update a student.");
    }

    await client.query("BEGIN");

    const currentResult = await client.query<StudentRow>(
      `
        SELECT *
        FROM students
        WHERE id = $1
        FOR UPDATE
      `,
      [studentId],
    );

    const current = currentResult.rows[0];

    if (!current || current.deleted_at !== null) {
      throw new StudentNotFoundError();
    }

    const before = { ...current };
    const sets: string[] = [];
    const values: Array<boolean | string | null> = [];

    if (input.fullName !== undefined) {
      values.push(normalizeRequiredText(input.fullName, "fullName"));
      sets.push(`full_name = $${values.length}`);
    }

    if (input.nickname !== undefined) {
      values.push(normalizeOptionalText(input.nickname));
      sets.push(`nickname = $${values.length}`);
    }

    if (input.preferredMode !== undefined) {
      values.push(normalizePreferredMode(input.preferredMode));
      sets.push(`preferred_mode = $${values.length}`);
    }

    if (input.phone !== undefined) {
      values.push(normalizeOptionalText(input.phone));
      sets.push(`phone = $${values.length}`);
    }

    if (input.email !== undefined) {
      values.push(normalizeOptionalText(input.email));
      sets.push(`email = $${values.length}`);
    }

    if (input.birthday !== undefined) {
      values.push(input.birthday);
      sets.push(`birthday = $${values.length}`);
    }

    if (input.joinedAt !== undefined) {
      values.push(input.joinedAt);
      sets.push(`joined_at = $${values.length}`);
    }

    if (input.note !== undefined) {
      values.push(normalizeOptionalText(input.note));
      sets.push(`note = $${values.length}`);
    }

    if (input.currency !== undefined) {
      assertTryCurrency(input.currency);
      values.push(input.currency);
      sets.push(`currency = $${values.length}`);
    }

    if (input.isActive !== undefined) {
      values.push(input.isActive);
      sets.push(`is_active = $${values.length}`);
    }

    if (sets.length === 0) {
      await client.query("COMMIT");
      return current;
    }

    values.push(String(studentId));

    const updateResult = await client.query<StudentRow>(
      `
        UPDATE students
        SET ${sets.join(", ")}
        WHERE id = $${values.length}
        RETURNING *
      `,
      values,
    );

    const updated = updateResult.rows[0];

    await insertAuditLog(client, {
      action: "student_updated",
      entityType: "student",
      entityId: updated.id,
      before,
      after: updated,
    });

    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function softDeleteStudent(studentId: EntityId): Promise<StudentRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const studentResult = await client.query<StudentRow>(
      `
        SELECT *
        FROM students
        WHERE id = $1
        FOR UPDATE
      `,
      [studentId],
    );

    const student = studentResult.rows[0];

    if (!student || student.deleted_at !== null) {
      throw new StudentNotFoundError();
    }

    const blockersResult = await client.query<{ entity_type: string; entity_id: string }>(
      `
        SELECT entity_type, entity_id
        FROM (
          SELECT 'lesson'::text AS entity_type, id::text AS entity_id
          FROM lessons
          WHERE student_id = $1 AND deleted_at IS NULL

          UNION ALL

          SELECT 'product_sale'::text AS entity_type, id::text AS entity_id
          FROM product_sales
          WHERE student_id = $1 AND deleted_at IS NULL

          UNION ALL

          SELECT 'prepaid_package'::text AS entity_type, id::text AS entity_id
          FROM prepaid_packages
          WHERE student_id = $1 AND deleted_at IS NULL
        ) blockers
        LIMIT 1
      `,
      [studentId],
    );

    const blocker = blockersResult.rows[0];

    if (blocker) {
      throw new DeleteConflictError(
        `Cannot delete student while active ${blocker.entity_type} #${blocker.entity_id} exists.`,
      );
    }

    const deletedResult = await client.query<StudentRow>(
      `
        UPDATE students
        SET deleted_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [studentId],
    );

    const deletedStudent = deletedResult.rows[0];

    await insertAuditLog(client, {
      action: "student_deleted",
      entityType: "student",
      entityId: deletedStudent.id,
      before: student,
    });

    await client.query("COMMIT");
    return deletedStudent;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// ─── Movements (granular, minute-precision activity stream) ─────────────────
// Returns every discrete event touching the student's record: lesson lifecycle
// transitions, package purchases, product sales, and individual payments.
// Unlike v_student_summary or the typed list endpoints, this surfaces each
// state change as its own row so the operator can audit what happened when.

export type StudentMovementRow = {
  occurred_at: string;
  kind:
    | "lesson_scheduled"
    | "lesson_completed"
    | "lesson_cancelled"
    | "lesson_no_show"
    | "lesson_discount_updated"
    | "package_purchased"
    | "product_sale"
    | "payment_lesson"
    | "payment_product_sale"
    | "payment_package";
  details: Record<string, unknown>;
};

export async function listStudentMovements(
  studentId: EntityId,
): Promise<StudentMovementRow[]> {
  await getStudentById(studentId);

  const result = await pool.query<StudentMovementRow>(
    `
      SELECT occurred_at, kind, details
      FROM (
        -- Ders planlandı (her ders için ilk oluşturma olayı)
        SELECT
          l.created_at AS occurred_at,
          'lesson_scheduled'::text AS kind,
          jsonb_build_object(
            'lesson_id',    l.id::text,
            'starts_at',    l.starts_at,
            'mode',         l.mode,
            'price',        l.price_snapshot,
            'prepaid_package_id', l.prepaid_package_id,
            'note',         l.note
          ) AS details
        FROM lessons l
        WHERE l.student_id = $1 AND l.deleted_at IS NULL

        UNION ALL

        -- Ders tamamlandı
        SELECT
          l.completed_at,
          'lesson_completed',
          jsonb_build_object(
            'lesson_id',    l.id::text,
            'starts_at',    l.starts_at,
            'mode',         l.mode,
            'price',        l.price_snapshot,
            'prepaid_package_id', l.prepaid_package_id,
            'note',         l.note
          )
        FROM lessons l
        WHERE l.student_id = $1 AND l.deleted_at IS NULL
          AND l.status = 'completed' AND l.completed_at IS NOT NULL

        UNION ALL

        -- Ders iptal / gelmedi (updated_at en iyi yaklaşıklık)
        SELECT
          l.updated_at,
          CASE WHEN l.status = 'no_show' THEN 'lesson_no_show' ELSE 'lesson_cancelled' END,
          jsonb_build_object(
            'lesson_id',    l.id::text,
            'starts_at',    l.starts_at,
            'mode',         l.mode,
            'price',        l.price_snapshot,
            'status',       l.status
          )
        FROM lessons l
        WHERE l.student_id = $1 AND l.deleted_at IS NULL
          AND l.status IN ('cancelled', 'no_show')

        UNION ALL

        -- Paket satın alındı
        SELECT
          p.purchased_at,
          'package_purchased',
          jsonb_build_object(
            'package_id',   p.id::text,
            'credit_count', p.credit_count,
            'unit_price',   p.unit_price,
            'total_amount', p.total_amount,
            'note',         p.note
          )
        FROM prepaid_packages p
        WHERE p.student_id = $1 AND p.deleted_at IS NULL

        UNION ALL

        -- Ürün satışı
        SELECT
          s.sold_at,
          'product_sale',
          jsonb_build_object(
            'sale_id',      s.id::text,
            'total_amount', s.total_amount,
            'note',         s.note
          )
        FROM product_sales s
        WHERE s.student_id = $1 AND s.deleted_at IS NULL

        UNION ALL

        -- Ödemeler (ders / ürün satışı / paket hedefli)
        SELECT
          pay.paid_at,
          CASE
            WHEN pay.lesson_id IS NOT NULL       THEN 'payment_lesson'
            WHEN pay.product_sale_id IS NOT NULL THEN 'payment_product_sale'
            ELSE                                      'payment_package'
          END,
          jsonb_build_object(
            'payment_id',       pay.id::text,
            'amount',           pay.amount,
            'source',           pay.source,
            'lesson_id',        pay.lesson_id,
            'product_sale_id',  pay.product_sale_id,
            'prepaid_package_id', pay.prepaid_package_id,
            'lesson_starts_at', l.starts_at,
            'lesson_mode',      l.mode,
            'note',             pay.note
          )
        FROM payments pay
        LEFT JOIN lessons          l  ON l.id  = pay.lesson_id
        LEFT JOIN product_sales    ps ON ps.id = pay.product_sale_id
        LEFT JOIN prepaid_packages pp ON pp.id = pay.prepaid_package_id
        WHERE pay.deleted_at IS NULL
          AND (l.student_id = $1 OR ps.student_id = $1 OR pp.student_id = $1)

        UNION ALL

        -- Ders indirimi olayları (karar 8 & 9). Her audit_logs satırı ayrı olay.
        SELECT
          a.created_at,
          'lesson_discount_updated',
          jsonb_build_object(
            'lesson_id',    l.id::text,
            'starts_at',    l.starts_at,
            'mode',         l.mode,
            'price',        l.price_snapshot,
            'old_discount', (a.before->>'discount_amount'),
            'new_discount', (a.after->>'discount_amount'),
            'note',         a.note
          )
        FROM audit_logs a
        JOIN lessons l ON l.id = a.entity_id
        WHERE a.action = 'lesson_discount_updated'
          AND a.entity_type = 'lesson'
          AND l.student_id = $1
          AND l.deleted_at IS NULL
      ) events
      ORDER BY occurred_at DESC, kind DESC
    `,
    [studentId],
  );

  return result.rows;
}
