import { pool } from "../db/connection.js";
import {
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

type Queryable = Pick<import("pg").PoolClient, "query">;

export type LessonMode = "online" | "onsite";

function normalizePreferredMode(value: unknown): LessonMode | null {
  if (value === null || value === undefined || value === "") return null;
  if (value === "online" || value === "onsite") return value;
  throw new ValidationError("preferredMode must be 'online', 'onsite', or null.");
}

export type StudentRow = {
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

// Bir öğrencinin başka bir domain işlemiyle (ör. etkinliğe katılımcı ekleme)
// aynı transaction içinde oluşturulabilmesi için transaction-sahibi olmayan
// çekirdek işlem. BEGIN/COMMIT çağıran tarafın sorumluluğundadır.
export async function createStudentWithClient(
  client: import("pg").PoolClient,
  input: CreateStudentInput,
): Promise<StudentRow> {
  const fullName = normalizeRequiredText(input.fullName, "fullName");
  const currency = input.currency ?? "TRY";

  assertTryCurrency(currency);

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
    actorUserId: input.actorUserId ?? null,
  });

  return student;
}

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
  lessons_this_week: string;
  // Son 12 hafta devam ritmi, en yeni → en eski: 'go' (o hafta ders tamamlandı),
  // 'no' (ders vardı ama iptal/gelmedi), 'skip' (o hafta ders yok). Roster
  // sparkline'ı bunu kullanır.
  weeks: Array<"go" | "no" | "skip">;
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
  actorUserId?: number | string | null;
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
      WITH wk_bounds AS (
        SELECT (date_trunc('week', now() AT TIME ZONE 'Europe/Istanbul')
                  AT TIME ZONE 'Europe/Istanbul') AS this_week_start
      )
      SELECT v.*, s.phone,
        att.last_lesson_at,
        att.lessons_last_30_days,
        att.lessons_this_week,
        wk.weeks
      FROM v_student_summary v
      JOIN students s ON s.id = v.id
      CROSS JOIN wk_bounds wb
      CROSS JOIN LATERAL (
        SELECT
          MAX(l.starts_at) FILTER (WHERE l.status = 'completed') AS last_lesson_at,
          COUNT(*) FILTER (
            WHERE l.status = 'completed'
              AND l.starts_at >= now() - interval '30 days'
          ) AS lessons_last_30_days,
          COUNT(*) FILTER (
            WHERE l.status IN ('scheduled', 'completed')
              AND l.starts_at >= wb.this_week_start
              AND l.starts_at <  wb.this_week_start + interval '7 days'
          ) AS lessons_this_week
        FROM lessons l
        WHERE l.student_id = s.id
          AND l.deleted_at IS NULL
      ) att
      -- Son 12 hafta (Pazartesi başlangıçlı, Europe/Istanbul). idx 0 = bu hafta
      -- (en yeni). Her hafta: tamamlanmış varsa 'go', iptal/gelmedi varsa 'no',
      -- hiç ders yoksa 'skip'.
      CROSS JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(b.bucket ORDER BY b.idx), '[]'::jsonb) AS weeks
        FROM (
          SELECT
            g.idx,
            CASE
              WHEN count(l.id) FILTER (WHERE l.status = 'completed') > 0 THEN 'go'
              WHEN count(l.id) FILTER (WHERE l.status IN ('cancelled', 'no_show')) > 0 THEN 'no'
              ELSE 'skip'
            END AS bucket
          FROM generate_series(0, 11) AS g(idx)
          LEFT JOIN lessons l
            ON l.student_id = s.id
            AND l.deleted_at IS NULL
            AND l.starts_at >= wb.this_week_start - (g.idx * interval '1 week')
            AND l.starts_at <  wb.this_week_start - (g.idx * interval '1 week') + interval '1 week'
          GROUP BY g.idx
        ) b
      ) wk
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

export type StudentsKpiResult = {
  activeCount: number;
  newThisMonth: number;
  debtorCount: number;
  totalDebt: string;
  inactiveOver14Days: number;
  monthlyCompletedLessons: number;
  previousMonthCompletedLessons: number;
};

export async function getStudentsKpi(): Promise<StudentsKpiResult> {
  const result = await pool.query(`
    WITH
      month_window AS (
        SELECT
          (date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul')
            AT TIME ZONE 'Europe/Istanbul')                              AS month_start,
          (date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul')
            AT TIME ZONE 'Europe/Istanbul' + INTERVAL '1 month')         AS month_end,
          (date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul')
            AT TIME ZONE 'Europe/Istanbul' - INTERVAL '1 month')         AS prev_month_start
      ),

      active_students AS (
        SELECT COUNT(*) AS cnt
        FROM students
        WHERE is_active = TRUE
          AND deleted_at IS NULL
      ),

      new_students AS (
        SELECT COUNT(*) AS cnt
        FROM students s, month_window mw
        WHERE s.deleted_at IS NULL
          AND COALESCE(s.joined_at, (s.created_at AT TIME ZONE 'Europe/Istanbul')::date)
              >= (mw.month_start AT TIME ZONE 'Europe/Istanbul')::date
          AND COALESCE(s.joined_at, (s.created_at AT TIME ZONE 'Europe/Istanbul')::date)
              <  (mw.month_end   AT TIME ZONE 'Europe/Istanbul')::date
      ),

      debtor_summary AS (
        SELECT
          COUNT(*) FILTER (WHERE (lesson_debt + product_debt) > 0.01)        AS cnt,
          COALESCE(SUM(GREATEST(0, lesson_debt + product_debt)), 0)          AS total
        FROM v_student_summary
      ),

      inactive_14d AS (
        SELECT COUNT(*) AS cnt
        FROM students s
        LEFT JOIN LATERAL (
          SELECT MAX(l.starts_at) AS last_lesson_at
          FROM lessons l
          WHERE l.student_id = s.id
            AND l.status = 'completed'
            AND l.deleted_at IS NULL
        ) att ON TRUE
        WHERE s.is_active = TRUE
          AND s.deleted_at IS NULL
          AND COALESCE(s.joined_at, (s.created_at AT TIME ZONE 'Europe/Istanbul')::date)
              <= (now() AT TIME ZONE 'Europe/Istanbul')::date - INTERVAL '14 days'
          AND (att.last_lesson_at IS NULL OR att.last_lesson_at < now() - INTERVAL '14 days')
      ),

      monthly_completed AS (
        SELECT COUNT(*) AS cnt
        FROM lessons l, month_window mw
        WHERE l.status = 'completed'
          AND l.starts_at >= mw.month_start
          AND l.starts_at <  mw.month_end
          AND l.deleted_at IS NULL
      ),

      prev_monthly_completed AS (
        SELECT COUNT(*) AS cnt
        FROM lessons l, month_window mw
        WHERE l.status = 'completed'
          AND l.starts_at >= mw.prev_month_start
          AND l.starts_at <  mw.month_start
          AND l.deleted_at IS NULL
      )

    SELECT
      active_students.cnt::int                AS active_count,
      new_students.cnt::int                   AS new_this_month,
      debtor_summary.cnt::int                 AS debtor_count,
      debtor_summary.total::text              AS total_debt,
      inactive_14d.cnt::int                   AS inactive_over_14_days,
      monthly_completed.cnt::int              AS monthly_completed_lessons,
      prev_monthly_completed.cnt::int         AS previous_month_completed_lessons
    FROM active_students,
         new_students,
         debtor_summary,
         inactive_14d,
         monthly_completed,
         prev_monthly_completed
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Öğrenci KPI sorgusu sonuç döndürmedi");
  }

  return {
    activeCount: Number(row["active_count"] ?? 0),
    newThisMonth: Number(row["new_this_month"] ?? 0),
    debtorCount: Number(row["debtor_count"] ?? 0),
    totalDebt: String(row["total_debt"] ?? "0"),
    inactiveOver14Days: Number(row["inactive_over_14_days"] ?? 0),
    monthlyCompletedLessons: Number(row["monthly_completed_lessons"] ?? 0),
    previousMonthCompletedLessons: Number(row["previous_month_completed_lessons"] ?? 0),
  };
}

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
    await client.query("BEGIN");
    const student = await createStudentWithClient(client, input);

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
  actorUserId?: number | string | null,
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
      actorUserId: actorUserId ?? null,
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

export type StudentDeleteImpact = {
  lessons: number;
  productSales: number;
  prepaidPackages: number;
  payments: number;
  paidTotal: string;
  eventParticipations: number;
  eventPayments: number;
  eventPaymentAllocations: number;
  eventPaidTotal: string;
  eventInteractions: number;
  participantNotes: number;
  noteMentions: number;
  drivenVehicles: number;
};

type StudentDeleteImpactQueryRow = {
  lessons: string;
  product_sales: string;
  prepaid_packages: string;
  payments: string;
  paid_total: string;
  event_participations: string;
  event_payments: string;
  event_payment_allocations: string;
  event_paid_total: string;
  event_interactions: string;
  participant_notes: string;
  note_mentions: string;
  driven_vehicles: string;
};

async function fetchStudentDeleteImpact(
  queryable: Queryable,
  studentId: EntityId,
): Promise<StudentDeleteImpact | null> {
  const result = await queryable.query<StudentDeleteImpactQueryRow>(
    `
      SELECT
        (SELECT count(*) FROM lessons          WHERE student_id = s.id) AS lessons,
        (SELECT count(*) FROM product_sales    WHERE student_id = s.id) AS product_sales,
        (SELECT count(*) FROM prepaid_packages WHERE student_id = s.id) AS prepaid_packages,
        (SELECT count(*) FROM payments p
           WHERE p.lesson_id          IN (SELECT id FROM lessons          WHERE student_id = s.id)
              OR p.product_sale_id    IN (SELECT id FROM product_sales    WHERE student_id = s.id)
              OR p.prepaid_package_id IN (SELECT id FROM prepaid_packages WHERE student_id = s.id)) AS payments,
        (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
           WHERE p.deleted_at IS NULL AND (
                 p.lesson_id          IN (SELECT id FROM lessons          WHERE student_id = s.id)
              OR p.product_sale_id    IN (SELECT id FROM product_sales    WHERE student_id = s.id)
              OR p.prepaid_package_id IN (SELECT id FROM prepaid_packages WHERE student_id = s.id)
           )) AS paid_total,
        (SELECT count(*) FROM event_participants WHERE student_id = s.id) AS event_participations,
        (SELECT count(*) FROM event_payments WHERE student_id = s.id) AS event_payments,
        (SELECT count(*)
           FROM event_payment_allocations a
           JOIN event_payments ep ON ep.id = a.payment_id
          WHERE ep.student_id = s.id) AS event_payment_allocations,
        (SELECT COALESCE(SUM(amount), 0)
           FROM event_payments
          WHERE student_id = s.id AND cancelled_at IS NULL) AS event_paid_total,
        (SELECT count(*) FROM event_participant_interactions WHERE student_id = s.id) AS event_interactions,
        (SELECT count(*)
           FROM event_participant_notes n
           JOIN event_participants p ON p.id = n.participant_id
          WHERE p.student_id = s.id) AS participant_notes,
        (SELECT count(*) FROM note_mentions WHERE student_id = s.id) AS note_mentions,
        (SELECT count(*) FROM event_vehicles WHERE driver_student_id = s.id) AS driven_vehicles
      FROM students s
      WHERE s.id = $1
    `,
    [studentId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    lessons: Number(row.lessons),
    productSales: Number(row.product_sales),
    prepaidPackages: Number(row.prepaid_packages),
    payments: Number(row.payments),
    paidTotal: row.paid_total,
    eventParticipations: Number(row.event_participations),
    eventPayments: Number(row.event_payments),
    eventPaymentAllocations: Number(row.event_payment_allocations),
    eventPaidTotal: row.event_paid_total,
    eventInteractions: Number(row.event_interactions),
    participantNotes: Number(row.participant_notes),
    noteMentions: Number(row.note_mentions),
    drivenVehicles: Number(row.driven_vehicles),
  };
}

// Silme modalının, yalnız eski ders/finans tablolarını değil etkinlik ve not
// bağlantılarını da aynı sunucu sözleşmesinden göstermesi için tek özet.
export async function getStudentDeleteImpact(studentId: EntityId): Promise<StudentDeleteImpact> {
  const impact = await fetchStudentDeleteImpact(pool, studentId);
  if (!impact) throw new StudentNotFoundError();
  return impact;
}

// Öğrenciyi ve TÜM finansal/operasyonel ayak izini kalıcı olarak (fiziksel) siler.
// Karar (2026-05-29): geçmişi olan öğrenci de silinebilsin. Bu, "borç =
// completed ders + satış" invariantının altındaki kayıtları yok eder ve geçmiş
// raporları (ciro, ders sayısı) geriye dönük değiştirir — geri alınamaz.
//
// Etkinlik tarafındaki sıra da önemlidir: payment allocations → event payments
// → participant bağlantıları. Genel notun kendisi başka kullanıcılara ait ortak
// içerik olabileceğinden korunur; yalnız note_mentions bağlantısı silinir.
// Öğrencinin şoför olduğu araçta başka yolcular bulunabilir: aracı silmek yerine
// kişisel şoför alanları temizlenip bağlantı anonim bir placeholder'a çevrilir.
//
// Tek kalan iz audit_logs olduğundan, silinen kayıtların özetini note'a yazarız.
export async function hardDeleteStudent(
  studentId: EntityId,
  actorUserId?: number | string | null,
): Promise<StudentRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Etkinlik servisleri kilitleri event → participant/student sırasıyla alır.
    // Aynı sırayı izlemek, ödeme/katılımcı ekleme ile hard-delete yarışında
    // deadlock riskini azaltır. Yeni bir referans bu sorgudan sonra eklenmeye
    // çalışırsa aşağıdaki student FOR UPDATE/FK key-share kilidi onu seri hale
    // getirir; önce tamamlanmışsa de impact ve DELETE sorgularına dahil olur.
    const relatedEvents = await client.query<{ event_id: string }>(
      `
        SELECT DISTINCT event_id::text AS event_id
          FROM (
            SELECT event_id FROM event_participants WHERE student_id = $1
            UNION ALL
            SELECT event_id FROM event_payments WHERE student_id = $1
            UNION ALL
            SELECT event_id FROM event_vehicles WHERE driver_student_id = $1
            UNION ALL
            SELECT event_id FROM event_participant_interactions WHERE student_id = $1
          ) related
         ORDER BY event_id
      `,
      [studentId],
    );
    if (relatedEvents.rows.length > 0) {
      await client.query(
        `SELECT id FROM events WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
        [relatedEvents.rows.map((row) => row.event_id)],
      );
    }

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

    if (!student) {
      throw new StudentNotFoundError();
    }

    // Silinecek/anonymize edilecek kayıtların özeti — audit ve önizleme aynı
    // alan adlarını kullanır, böylece yeni bir FK sessizce kapsam dışında kalmaz.
    const counts = await fetchStudentDeleteImpact(client, studentId);
    if (!counts) throw new StudentNotFoundError();

    // 1) Etkinlik tahsilat dağılımları ve tahsilatlar. Allocation FK'sinde
    //    cascade yoktur; deferred toplam trigger'ı payment da aynı transaction'da
    //    silindiği için commit anında artık hedef bulmaz.
    await client.query(
      `DELETE FROM event_payment_allocations
        WHERE payment_id IN (SELECT id FROM event_payments WHERE student_id = $1)`,
      [studentId],
    );
    await client.query(`DELETE FROM event_payments WHERE student_id = $1`, [studentId]);

    // 2) Ortak notlar korunur, yalnız silinen öğrenciye ait @ bağlantısı gider.
    await client.query(`DELETE FROM note_mentions WHERE student_id = $1`, [studentId]);

    // 3) Şoförün aracı başka öğrencileri taşıyor olabilir. Aracı/yolcu planını
    //    koru, fakat silinen kişiye ait bağlantı/ad/telefon bilgisini temizle.
    await client.query(
      `UPDATE event_vehicles
          SET driver_student_id = NULL,
              driver_name = 'Silinmiş öğrenci',
              driver_phone = NULL
        WHERE driver_student_id = $1`,
      [studentId],
    );

    // 4) Hedef katılımcıya bağlı misafirleri silmek, başka öğrencilerin kaydını
    //    da yok ederdi. Onları bağımsız katılımcıya çevir; hedefin kendi ücret ve
    //    profil notları participant DELETE CASCADE ile gider.
    await client.query(
      `UPDATE event_participants
          SET guest_of_participant_id = NULL
        WHERE guest_of_participant_id IN (
          SELECT id FROM event_participants WHERE student_id = $1
        )`,
      [studentId],
    );
    await client.query(`DELETE FROM event_participant_interactions WHERE student_id = $1`, [studentId]);
    await client.query(`DELETE FROM event_participants WHERE student_id = $1`, [studentId]);

    // 5) Ödemeler (lessons/sales/packages'a referans verir — soft-deleted dahil
    //    hepsi fiziksel silinmeli ki RESTRICT FK'ler çözülsün).
    await client.query(
      `
        DELETE FROM payments
        WHERE lesson_id          IN (SELECT id FROM lessons          WHERE student_id = $1)
           OR product_sale_id    IN (SELECT id FROM product_sales    WHERE student_id = $1)
           OR prepaid_package_id IN (SELECT id FROM prepaid_packages WHERE student_id = $1)
      `,
      [studentId],
    );

    // 6) Ürün satışları (product_sale_items ON DELETE CASCADE ile otomatik gider;
    //    ayrıca lessons'a olası lesson_id referansı bu adımda temizlenmiş olur).
    await client.query(`DELETE FROM product_sales WHERE student_id = $1`, [studentId]);

    // 7) Dersler (prepaid_packages'a referans verir → paketlerden önce).
    await client.query(`DELETE FROM lessons WHERE student_id = $1`, [studentId]);

    // 8) Paketler.
    await client.query(`DELETE FROM prepaid_packages WHERE student_id = $1`, [studentId]);

    // 9) Öğrenci. lesson_type_student_prices ve calendar_event_participants
    //    mevcut ON DELETE CASCADE sözleşmeleriyle otomatik temizlenir.
    await client.query(`DELETE FROM students WHERE id = $1`, [studentId]);

    await insertAuditLog(client, {
      action: "student_deleted",
      entityType: "student",
      entityId: student.id,
      before: student,
      note:
        `hard_delete · lessons=${counts.lessons} · product_sales=${counts.productSales} · ` +
        `prepaid_packages=${counts.prepaidPackages} · payments=${counts.payments} · ` +
        `paid_total=${counts.paidTotal} · event_participations=${counts.eventParticipations} · ` +
        `event_payments=${counts.eventPayments} · event_payment_allocations=${counts.eventPaymentAllocations} · ` +
        `event_paid_total=${counts.eventPaidTotal} · event_interactions=${counts.eventInteractions} · ` +
        `participant_notes=${counts.participantNotes} · note_mentions=${counts.noteMentions} · ` +
        `driven_vehicles=${counts.drivenVehicles}`,
      actorUserId: actorUserId ?? null,
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
