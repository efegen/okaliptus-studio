import { pool } from "../db/connection.js";
import {
  DeleteConflictError,
  DiscountNotAllowedError,
  DiscountWouldExceedNetError,
  InvalidStatusTransitionError,
  LessonConflictError,
  LessonNotFoundError,
  StudentNotFoundError,
  ValidationError,
  toServiceError,
} from "./errors.js";
import {
  centsToMoney,
  insertAuditLog,
  moneyToCents,
  normalizeMoneyInput,
  normalizeOptionalText,
  rollbackQuietly,
  type EntityId,
  type LessonMode,
  type LessonStatus,
  type MoneyInput,
} from "./shared.js";

type StudentRow = {
  id: string;
  deleted_at: string | null;
};

type LessonRow = {
  id: string;
  student_id: string;
  instructor_id: string;
  lesson_type_id: string;
  starts_at: string;
  completed_at: string | null;
  mode: LessonMode;
  status: LessonStatus;
  duration_minutes: number;
  price_snapshot: string;
  discount_amount: string;
  currency: string;
  prepaid_package_id: string | null;
  note: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type LessonDefaultsRow = {
  instructor_id: string | null;
  lesson_type_id: string | null;
  duration_minutes: number | null;
  default_price: string | null;
  currency: string | null;
};

type PackageRow = {
  id: string;
  unit_price: string;
};

export type CreateLessonInput = {
  studentId: EntityId;
  startsAt: string;
  mode: LessonMode;
  note?: string | null;
  instructorId?: EntityId | null;
  lessonTypeId?: EntityId | null;
  actorUserId?: number | string | null;
};

export async function getLessonById(lessonId: EntityId): Promise<LessonRow> {
  const result = await pool.query<LessonRow>(
    `
      SELECT *
      FROM lessons
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [lessonId],
  );

  const lesson = result.rows[0];

  if (!lesson) {
    throw new LessonNotFoundError();
  }

  return lesson;
}

type LessonDetailRow = LessonRow & {
  net_amount: string;
  paid_amount: string;
  remaining_receivable: string;
  payment_source: 'cash' | 'iban' | null;
};

export async function listLessonsForStudent(studentId: EntityId): Promise<LessonDetailRow[]> {
  const result = await pool.query<LessonDetailRow>(
    `
      SELECT
        l.*,
        (l.price_snapshot - l.discount_amount) AS net_amount,
        COALESCE(pay.paid_sum, 0) AS paid_amount,
        GREATEST(
          0,
          (l.price_snapshot - l.discount_amount) - COALESCE(pay.paid_sum, 0)
        ) AS remaining_receivable,
        pay.source AS payment_source
      FROM lessons l
      LEFT JOIN (
        SELECT lesson_id, SUM(amount) AS paid_sum, MAX(source) AS source
        FROM payments
        WHERE lesson_id IS NOT NULL AND deleted_at IS NULL
        GROUP BY lesson_id
      ) pay ON pay.lesson_id = l.id
      WHERE l.student_id = $1
        AND l.deleted_at IS NULL
      ORDER BY l.starts_at DESC, l.id DESC
    `,
    [studentId],
  );

  return result.rows;
}

export type LessonWithStudentRow = LessonRow & {
  student_name: string;
  student_nickname: string | null;
  net_amount: string;
  paid_amount: string;
  payment_source: 'cash' | 'iban' | null;
};

export async function listLessonsInRange(
  fromIso: string,
  toIso: string,
): Promise<LessonWithStudentRow[]> {
  const from = new Date(fromIso);
  const to = new Date(toIso);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ValidationError("from and to must be valid ISO-8601 timestamps.");
  }
  if (to <= from) {
    throw new ValidationError("to must be after from.");
  }

  // v1.6: ders bloğu yalnızca derse ait verileri döndürür. Ürün satışı
  // (lesson_id'siz veya aynı gün/öğrenci) artık takvimde gösterilmiyor —
  // satışlar ürün satış modülünden ve öğrenci profilinden takip edilir.
  const result = await pool.query<LessonWithStudentRow>(
    `
      SELECT
        l.*,
        s.full_name AS student_name,
        s.nickname AS student_nickname,
        (l.price_snapshot - l.discount_amount) AS net_amount,
        COALESCE(pay.paid_sum, 0) AS paid_amount,
        pay.source AS payment_source
      FROM lessons l
      JOIN students s ON s.id = l.student_id
      LEFT JOIN (
        SELECT lesson_id, SUM(amount) AS paid_sum, MAX(source) AS source
        FROM payments
        WHERE lesson_id IS NOT NULL AND deleted_at IS NULL
        GROUP BY lesson_id
      ) pay ON pay.lesson_id = l.id
      WHERE l.deleted_at IS NULL
        AND l.starts_at >= $1
        AND l.starts_at <  $2
      ORDER BY l.starts_at ASC, l.id ASC
    `,
    [from.toISOString(), to.toISOString()],
  );

  return result.rows;
}

export async function createLesson(input: CreateLessonInput): Promise<LessonRow> {
  const client = await pool.connect();

  try {
    if (input.mode !== "online" && input.mode !== "onsite") {
      throw new ValidationError("mode must be either 'online' or 'onsite'.");
    }

    await client.query("BEGIN");

    const studentResult = await client.query<StudentRow>(
      `
        SELECT id, deleted_at
        FROM students
        WHERE id = $1
        FOR UPDATE
      `,
      [input.studentId],
    );

    const student = studentResult.rows[0];

    if (!student || student.deleted_at !== null) {
      throw new StudentNotFoundError();
    }

    // UI artık instructor ve lesson type'ı gönderiyor (modal'daki select'ler).
    // Geriye dönük uyumluluk için boş bırakılırsa ilk aktif kaydı otomatik
    // atarız — eski çağrıcıların kırılmaması için.
    const instructorIdParam =
      input.instructorId != null && input.instructorId !== "" ? input.instructorId : null;
    const lessonTypeIdParam =
      input.lessonTypeId != null && input.lessonTypeId !== "" ? input.lessonTypeId : null;

    // Fiyat ve currency ders türünden gelir (yeni model). price_snapshot,
    // lesson_type.default_price'ın insert anındaki kopyasıdır; sonradan otomatik
    // değişmez (§2.3).
    //
    // Öğrenciye özel fiyat (migration 0238): bu öğrenci+tür için bir override
    // varsa default_price yerine custom_price kullanılır (0 = ücretsiz). Override
    // create anında snapshot'a kopyalanır; paket kredisi yine completeLesson'da
    // önceliklidir.
    const defaultsResult = await client.query<LessonDefaultsRow>(
      `
        WITH resolved AS (
          SELECT
            CASE
              WHEN $1::bigint IS NOT NULL THEN (
                SELECT id FROM instructors
                WHERE id = $1::bigint
                  AND is_active
                  AND deleted_at IS NULL
              )
              ELSE (
                SELECT id FROM instructors
                WHERE is_active AND deleted_at IS NULL
                ORDER BY id ASC LIMIT 1
              )
            END AS instructor_id,
            CASE
              WHEN $2::bigint IS NOT NULL THEN (
                SELECT id FROM lesson_types
                WHERE id = $2::bigint
                  AND is_active
                  AND deleted_at IS NULL
              )
              ELSE (
                SELECT id FROM lesson_types
                WHERE is_active AND deleted_at IS NULL
                ORDER BY id ASC LIMIT 1
              )
            END AS lesson_type_id
        )
        SELECT
          r.instructor_id,
          r.lesson_type_id,
          lt.default_duration_minutes              AS duration_minutes,
          COALESCE(ltsp.custom_price, lt.default_price) AS default_price,
          lt.currency                              AS currency
        FROM resolved r
        LEFT JOIN lesson_types lt ON lt.id = r.lesson_type_id
        LEFT JOIN lesson_type_student_prices ltsp
          ON ltsp.lesson_type_id = r.lesson_type_id
         AND ltsp.student_id = $3::bigint
      `,
      [instructorIdParam, lessonTypeIdParam, input.studentId],
    );

    const defaults = defaultsResult.rows[0];

    if (instructorIdParam !== null && (!defaults || defaults.instructor_id === null)) {
      throw new ValidationError(
        `Instructor ${String(instructorIdParam)} is not active or does not exist.`,
      );
    }
    if (lessonTypeIdParam !== null && (!defaults || defaults.lesson_type_id === null)) {
      throw new ValidationError(
        `Lesson type ${String(lessonTypeIdParam)} is not active or does not exist.`,
      );
    }
    if (
      !defaults ||
      defaults.instructor_id === null ||
      defaults.lesson_type_id === null ||
      defaults.duration_minutes === null ||
      defaults.default_price === null ||
      defaults.currency === null
    ) {
      throw new ValidationError(
        "No active instructor or lesson type is configured; cannot create a lesson.",
      );
    }

    const conflictResult = await client.query<{
      student_conflict: boolean;
      instructor_conflict: boolean;
    }>(
      `
        SELECT
          EXISTS (
            SELECT 1 FROM lessons
            WHERE deleted_at IS NULL
              AND status NOT IN ('cancelled', 'no_show')
              AND student_id = $1
              AND starts_at < $2::timestamptz + ($3 * INTERVAL '1 minute')
              AND (starts_at + duration_minutes * INTERVAL '1 minute') > $2::timestamptz
          ) AS student_conflict,
          EXISTS (
            SELECT 1 FROM lessons
            WHERE deleted_at IS NULL
              AND status NOT IN ('cancelled', 'no_show')
              AND instructor_id = $4
              AND starts_at < $2::timestamptz + ($3 * INTERVAL '1 minute')
              AND (starts_at + duration_minutes * INTERVAL '1 minute') > $2::timestamptz
          ) AS instructor_conflict
      `,
      [input.studentId, input.startsAt, defaults.duration_minutes, defaults.instructor_id],
    );

    const { student_conflict, instructor_conflict } = conflictResult.rows[0];

    if (student_conflict) {
      throw new LessonConflictError("Bu öğrencinin bu saatte zaten bir dersi var.");
    }
    if (instructor_conflict) {
      throw new LessonConflictError("Bu eğitmenin bu saatte zaten bir dersi var.");
    }

    const insertResult = await client.query<LessonRow>(
      `
        INSERT INTO lessons (
          student_id,
          instructor_id,
          lesson_type_id,
          starts_at,
          mode,
          status,
          duration_minutes,
          price_snapshot,
          currency,
          note
        )
        VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, $7, $8, $9)
        RETURNING *
      `,
      [
        input.studentId,
        defaults.instructor_id,
        defaults.lesson_type_id,
        input.startsAt,
        input.mode,
        defaults.duration_minutes,
        defaults.default_price,
        defaults.currency,
        normalizeOptionalText(input.note),
      ],
    );

    const lesson = insertResult.rows[0];

    await insertAuditLog(client, {
      action: "lesson_created",
      entityType: "lesson",
      entityId: lesson.id,
      after: lesson,
      actorUserId: input.actorUserId ?? null,
    });

    await client.query("COMMIT");
    return lesson;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// Ders tamamlama: sadece status geçişi + paket kredisi tahsisi. Ürün satışı
// artık bu akışta yaratılmıyor — v2 ürün satış modülü ayrı. Ders bloğu üzerinde
// gösterilen satışlar listLessonsInRange içinde aynı gün/öğrenci eşleşmesi ile
// bulunur (DB'de doğrudan bağ yok).
//
// Operatör yanlışlıkla yarınki dersi "tamamlandı" işaretlemesin diye: ders ancak
// başlangıcından MIN_MINUTES_AFTER_START_TO_COMPLETE dakika geçtikten sonra
// tamamlanabilir. UI aynı kuralı önden uygular; bu sunucu kontrolü son savunma
// hattıdır.
export const MIN_MINUTES_AFTER_START_TO_COMPLETE = 20;

export type CompleteLessonResult = {
  lesson: LessonRow;
};

export async function completeLesson(
  lessonId: EntityId,
  actorUserId?: number | string | null,
): Promise<CompleteLessonResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const lessonResult = await client.query<LessonRow>(
      `
        SELECT *
        FROM lessons
        WHERE id = $1
        FOR UPDATE
      `,
      [lessonId],
    );

    const lesson = lessonResult.rows[0];

    if (!lesson || lesson.deleted_at !== null) {
      throw new LessonNotFoundError("Lesson not found or deleted.");
    }

    if (lesson.status === "completed") {
      throw new InvalidStatusTransitionError("Lesson is already completed.");
    }

    const startsAtMs = new Date(lesson.starts_at).getTime();
    const earliestCompletableMs =
      startsAtMs + MIN_MINUTES_AFTER_START_TO_COMPLETE * 60 * 1000;
    if (Number.isFinite(startsAtMs) && Date.now() < earliestCompletableMs) {
      throw new InvalidStatusTransitionError(
        `Ders henüz tamamlanamaz. Tamamlamak için ders başladıktan en az ${MIN_MINUTES_AFTER_START_TO_COMPLETE} dakika geçmiş olmalı.`,
      );
    }

    const before = { ...lesson };

    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [`student_prepaid_${lesson.student_id}`],
    );

    const activePackageResult = await client.query<PackageRow>(
      `
        SELECT pp.id, pp.unit_price
        FROM prepaid_packages pp
        JOIN v_prepaid_package_status vs
          ON vs.package_id = pp.id
        WHERE pp.student_id = $1
          AND vs.remaining_credits > 0
          AND pp.deleted_at IS NULL
        ORDER BY pp.purchased_at ASC, pp.id ASC
        LIMIT 1
        FOR UPDATE OF pp
      `,
      [lesson.student_id],
    );

    const activePackage = activePackageResult.rows[0];

    const updateResult = activePackage
      ? await client.query<LessonRow>(
          `
            UPDATE lessons
            SET status = 'completed',
                completed_at = now(),
                prepaid_package_id = $2,
                price_snapshot = $3
            WHERE id = $1
            RETURNING *
          `,
          [lessonId, activePackage.id, activePackage.unit_price],
        )
      : await client.query<LessonRow>(
          `
            UPDATE lessons
            SET status = 'completed',
                completed_at = now()
            WHERE id = $1
            RETURNING *
          `,
          [lessonId],
        );

    const completedLesson = updateResult.rows[0];

    await insertAuditLog(client, {
      action: "lesson_status_change",
      entityType: "lesson",
      entityId: completedLesson.id,
      before,
      after: completedLesson,
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
    return { lesson: completedLesson };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function uncompleteLesson(
  lessonId: EntityId,
  actorUserId?: number | string | null,
): Promise<LessonRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const lessonResult = await client.query<LessonRow>(
      `
        SELECT *
        FROM lessons
        WHERE id = $1
        FOR UPDATE
      `,
      [lessonId],
    );

    const lesson = lessonResult.rows[0];

    if (!lesson || lesson.deleted_at !== null) {
      throw new LessonNotFoundError();
    }

    if (lesson.status !== "completed") {
      throw new InvalidStatusTransitionError("Sadece 'tamamlandı' durumundaki dersler geri alınabilir.");
    }

    if (!lesson.completed_at) {
      throw new InvalidStatusTransitionError("Tamamlanma tarihi bulunamadı.");
    }

    const completedAt = new Date(lesson.completed_at);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (completedAt < cutoff) {
      throw new InvalidStatusTransitionError(
        "Bu kadar eski bir dersi geri alamazsınız. 24 saatten eski tamamlamalar için ödemeyi silin ve dersi yeniden oluşturun.",
      );
    }

    // Derse ait aktif ödeme varsa reddet — önce ödemelerin silinmesi gerekir
    const paymentResult = await client.query<{ id: string }>(
      `
        SELECT id FROM payments
        WHERE lesson_id = $1 AND deleted_at IS NULL
        LIMIT 1
      `,
      [lessonId],
    );

    if (paymentResult.rows[0]) {
      throw new InvalidStatusTransitionError(
        "Dersin aktif ödemeleri var. Geri almadan önce ödemeleri silin.",
      );
    }

    const before = { ...lesson };

    const updateResult = await client.query<LessonRow>(
      `
        UPDATE lessons
        SET status = 'scheduled',
            completed_at = NULL,
            prepaid_package_id = NULL
        WHERE id = $1
        RETURNING *
      `,
      [lessonId],
    );

    const revertedLesson = updateResult.rows[0];

    await insertAuditLog(client, {
      action: "lesson_uncompleted",
      entityType: "lesson",
      entityId: revertedLesson.id,
      before,
      after: revertedLesson,
      note: "Ders geri alındı",
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
    return revertedLesson;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function changeLessonStatus(
  lessonId: EntityId,
  newStatus: LessonStatus,
  actorUserId?: number | string | null,
): Promise<LessonRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const lessonResult = await client.query<LessonRow>(
      `
        SELECT *
        FROM lessons
        WHERE id = $1
        FOR UPDATE
      `,
      [lessonId],
    );

    const lesson = lessonResult.rows[0];

    if (!lesson || lesson.deleted_at !== null) {
      throw new LessonNotFoundError();
    }

    if (lesson.status === newStatus) {
      await client.query("COMMIT");
      return lesson;
    }

    if (
      lesson.status === "completed" &&
      (newStatus === "cancelled" || newStatus === "no_show" || newStatus === "scheduled")
    ) {
      throw new InvalidStatusTransitionError(
        "Completed lessons cannot be reverted. Delete payments and the lesson, then recreate it.",
      );
    }

    if (lesson.status !== "completed" && newStatus === "completed") {
      throw new InvalidStatusTransitionError(
        "Use completeLesson() for transitions to completed so credit allocation runs atomically.",
      );
    }

    const before = { ...lesson };

    const updateResult = await client.query<LessonRow>(
      `
        UPDATE lessons
        SET status = $2
        WHERE id = $1
        RETURNING *
      `,
      [lessonId, newStatus],
    );

    const updatedLesson = updateResult.rows[0];

    await insertAuditLog(client, {
      action: "lesson_status_change",
      entityType: "lesson",
      entityId: updatedLesson.id,
      before,
      after: updatedLesson,
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
    return updatedLesson;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export type SetDiscountInput = {
  lessonId: EntityId;
  discountAmount: MoneyInput;
  note?: string | null;
  actorUserId?: number | string | null;
};

export type SetDiscountResult = {
  lesson: LessonRow;
  old_discount: string;
  new_discount: string;
};

// NOT: Ders-bazı manuel indirimin HTTP endpoint'i (PATCH /lessons/:id/discount)
// ve frontend UI'ı v1.6'da kaldırıldı; indirim artık öğrenci × ders türü bazında
// özel fiyatla (createLesson'da price_snapshot override) yönetiliyor. Bu servis
// fonksiyonu DORMANT olarak korunuyor: discount_amount kolonu + net_amount
// view'ları (net = price_snapshot - discount_amount) hâlâ canlı ve smoke testleri
// (09/10/16/99) bu makineyi bu fonksiyonla doğruluyor. Manuel indirim geri
// istenince yalnız route + UI tekrar bağlanır.
//
// Idempotent set — verilen değer mevcut discount_amount'u üzerine yazar; 0
// indirimi kaldırır. Kısıtlar: sadece completed & non-prepaid derse uygulanabilir;
// 0 <= discount_amount <= price_snapshot; paid_amount <= price_snapshot - discount.
export async function setLessonDiscount(
  input: SetDiscountInput,
): Promise<SetDiscountResult> {
  const client = await pool.connect();

  try {
    const newDiscount = normalizeMoneyInput(input.discountAmount, "discountAmount", {
      allowZero: true,
    });

    await client.query("BEGIN");

    const lessonResult = await client.query<LessonRow & { paid_amount: string }>(
      `
        SELECT l.*,
          COALESCE((
            SELECT SUM(amount) FROM payments
            WHERE lesson_id = l.id AND deleted_at IS NULL
          ), 0)::text AS paid_amount
        FROM lessons l
        WHERE l.id = $1
        FOR UPDATE
      `,
      [input.lessonId],
    );

    const lesson = lessonResult.rows[0];

    if (!lesson || lesson.deleted_at !== null) {
      throw new LessonNotFoundError();
    }

    if (lesson.status !== "completed") {
      throw new DiscountNotAllowedError(
        "Discount can only be applied to completed lessons.",
      );
    }

    if (lesson.prepaid_package_id !== null) {
      throw new DiscountNotAllowedError(
        "Discount cannot be applied to a lesson covered by a prepaid package.",
      );
    }

    const priceCents = moneyToCents(lesson.price_snapshot, "price_snapshot");
    const discountCents = moneyToCents(newDiscount, "discountAmount");
    const paidCents = moneyToCents(lesson.paid_amount, "paid_amount");

    if (discountCents > priceCents) {
      throw new ValidationError(
        "discountAmount cannot exceed the lesson price_snapshot.",
      );
    }

    if (paidCents > priceCents - discountCents) {
      throw new DiscountWouldExceedNetError();
    }

    const oldDiscount = lesson.discount_amount;
    const oldCents = moneyToCents(oldDiscount, "oldDiscount");

    if (oldCents === discountCents) {
      await client.query("COMMIT");
      return {
        lesson,
        old_discount: centsToMoney(oldCents),
        new_discount: newDiscount,
      };
    }

    const updateResult = await client.query<LessonRow>(
      `
        UPDATE lessons
        SET discount_amount = $2
        WHERE id = $1
        RETURNING *
      `,
      [input.lessonId, newDiscount],
    );

    const updated = updateResult.rows[0];

    await insertAuditLog(client, {
      action: "lesson_discount_updated",
      entityType: "lesson",
      entityId: updated.id,
      before: { discount_amount: oldDiscount },
      after: { discount_amount: newDiscount },
      note: normalizeOptionalText(input.note),
      actorUserId: input.actorUserId ?? null,
    });

    await client.query("COMMIT");
    return { lesson: updated, old_discount: oldDiscount, new_discount: newDiscount };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function softDeleteLesson(
  lessonId: EntityId,
  actorUserId?: number | string | null,
): Promise<LessonRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const lessonResult = await client.query<LessonRow>(
      `
        SELECT *
        FROM lessons
        WHERE id = $1
        FOR UPDATE
      `,
      [lessonId],
    );

    const lesson = lessonResult.rows[0];

    if (!lesson || lesson.deleted_at !== null) {
      throw new LessonNotFoundError();
    }

    const activePaymentResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM payments
        WHERE lesson_id = $1
          AND deleted_at IS NULL
        LIMIT 1
        FOR UPDATE
      `,
      [lessonId],
    );

    if (activePaymentResult.rows[0]) {
      throw new DeleteConflictError(
        "Lesson has active payments. Delete those payments before soft-deleting the lesson.",
      );
    }

    const deletedResult = await client.query<LessonRow>(
      `
        UPDATE lessons
        SET deleted_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [lessonId],
    );

    const deletedLesson = deletedResult.rows[0];

    await insertAuditLog(client, {
      action: "lesson_deleted",
      entityType: "lesson",
      entityId: deletedLesson.id,
      before: lesson,
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
    return deletedLesson;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}
