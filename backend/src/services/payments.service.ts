import type { PoolClient } from "pg";

import { pool } from "../db/connection.js";
import {
  LessonNotFoundError,
  OverpaymentNotAllowedError,
  PackagePaymentDeleteForbiddenError,
  PaymentNotFoundError,
  PaymentTargetMismatchError,
  ProductSaleNotFoundError,
  ValidationError,
  toServiceError,
} from "./errors.js";
import {
  insertAuditLog,
  moneyToCents,
  normalizeMoneyInput,
  normalizeOptionalText,
  rollbackQuietly,
  type EntityId,
  type PaymentSource,
  type PaymentTargetType,
} from "./shared.js";

type LessonTargetRow = {
  id: string;
  student_id: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  prepaid_package_id: string | null;
  currency: string;
  deleted_at: string | null;
  remaining_debt: string;
};

type ProductSaleTargetRow = {
  id: string;
  student_id: string;
  currency: string;
  deleted_at: string | null;
  remaining_debt: string;
};

type PaymentRow = {
  id: string;
  paid_at: string;
  amount: string;
  currency: string;
  source: PaymentSource;
  lesson_id: string | null;
  product_sale_id: string | null;
  prepaid_package_id: string | null;
  note: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type LockedTarget = {
  studentId: string;
  currency: string;
  remainingDebt: string;
  paymentColumn: "lesson_id" | "product_sale_id";
};

export type CreateCashPaymentInput = {
  targetType: PaymentTargetType;
  targetId: EntityId;
  amount: EntityId;
  source: Extract<PaymentSource, "cash" | "iban">;
  paidAt: string;
  note?: string | null;
};

type CreatePaymentResult = {
  payment: PaymentRow;
};

export async function getPaymentById(paymentId: EntityId): Promise<PaymentRow> {
  const result = await pool.query<PaymentRow>(
    `
      SELECT *
      FROM payments
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [paymentId],
  );

  const payment = result.rows[0];

  if (!payment) {
    throw new PaymentNotFoundError();
  }

  return payment;
}

// Halihazırda açık bir transaction içinden çağrılır (örn. completeLesson). Kendi
// BEGIN/COMMIT'ini yönetmez. Çağıran taraf transaction'ı yönetir; bu sayede
// ders tamamlama → ürün satışı → ödeme zinciri tek atomik birim olur.
export async function createCashPaymentWithClient(
  client: PoolClient,
  input: CreateCashPaymentInput,
): Promise<CreatePaymentResult> {
  if (input.source !== "cash" && input.source !== "iban") {
    throw new ValidationError("source must be either 'cash' or 'iban'.");
  }

  const amount = normalizeMoneyInput(input.amount, "amount");

  const target = await lockPaymentTarget(client, input.targetType, input.targetId);

  if (moneyToCents(amount, "amount") > moneyToCents(target.remainingDebt, "remainingDebt")) {
    throw new OverpaymentNotAllowedError();
  }

  const paymentResult = await client.query<PaymentRow>(
    `
      INSERT INTO payments (paid_at, amount, currency, source, ${target.paymentColumn}, note)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [
      input.paidAt,
      amount,
      target.currency,
      input.source,
      input.targetId,
      normalizeOptionalText(input.note),
    ],
  );

  const payment = paymentResult.rows[0];

  await insertAuditLog(client, {
    action: "payment_created",
    entityType: "payment",
    entityId: payment.id,
    after: payment,
  });

  return { payment };
}

export async function createCashPayment(
  input: CreateCashPaymentInput,
): Promise<CreatePaymentResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await createCashPaymentWithClient(client, input);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function deletePayment(paymentId: EntityId): Promise<{
  payment: PaymentRow;
}> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paymentResult = await client.query<PaymentRow>(
      `
        SELECT *
        FROM payments
        WHERE id = $1
        FOR UPDATE
      `,
      [paymentId],
    );

    const payment = paymentResult.rows[0];

    if (!payment) {
      throw new PaymentNotFoundError();
    }

    if (payment.deleted_at !== null) {
      throw new PaymentNotFoundError("Payment is already deleted.");
    }

    if (payment.prepaid_package_id !== null) {
      throw new PackagePaymentDeleteForbiddenError(
        "Cannot delete payment bound to prepaid_package. Use deletePrepaidPackage() instead.",
      );
    }

    const before = { ...payment };

    const deletedPaymentResult = await client.query<PaymentRow>(
      `
        UPDATE payments
        SET deleted_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [paymentId],
    );

    const deletedPayment = deletedPaymentResult.rows[0];

    await insertAuditLog(client, {
      action: "payment_deleted",
      entityType: "payment",
      entityId: deletedPayment.id,
      before,
    });

    await client.query("COMMIT");
    return { payment: deletedPayment };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

async function lockPaymentTarget(
  client: PoolClient,
  targetType: PaymentTargetType,
  targetId: EntityId,
): Promise<LockedTarget> {
  if (targetType === "lesson") {
    const lessonResult = await client.query<LessonTargetRow>(
      `
        SELECT
          l.id,
          l.student_id,
          l.status,
          l.prepaid_package_id,
          l.currency,
          l.deleted_at,
          GREATEST(
            0,
            (l.price_snapshot - l.discount_amount) - COALESCE((
              SELECT SUM(amount)
              FROM payments
              WHERE lesson_id = l.id
                AND deleted_at IS NULL
            ), 0)
          )::text AS remaining_debt
        FROM lessons l
        WHERE l.id = $1
        FOR UPDATE
      `,
      [targetId],
    );

    const lesson = lessonResult.rows[0];

    if (!lesson || lesson.deleted_at !== null) {
      throw new LessonNotFoundError();
    }

    if (lesson.status !== "completed") {
      throw new PaymentTargetMismatchError("Payments are only allowed on completed lessons.");
    }

    if (lesson.prepaid_package_id !== null) {
      throw new PaymentTargetMismatchError(
        "Credit-covered lessons are already settled and cannot receive payments.",
      );
    }

    return {
      studentId: lesson.student_id,
      currency: lesson.currency,
      remainingDebt: lesson.remaining_debt,
      paymentColumn: "lesson_id",
    };
  }

  const saleResult = await client.query<ProductSaleTargetRow>(
    `
      SELECT
        ps.id,
        ps.student_id,
        ps.currency,
        ps.deleted_at,
        GREATEST(
          0,
          ps.total_amount - COALESCE((
            SELECT SUM(amount)
            FROM payments
            WHERE product_sale_id = ps.id
              AND deleted_at IS NULL
          ), 0)
        )::text AS remaining_debt
      FROM product_sales ps
      WHERE ps.id = $1
      FOR UPDATE
    `,
    [targetId],
  );

  const sale = saleResult.rows[0];

  if (!sale || sale.deleted_at !== null) {
    throw new ProductSaleNotFoundError();
  }

  return {
    studentId: sale.student_id,
    currency: sale.currency,
    remainingDebt: sale.remaining_debt,
    paymentColumn: "product_sale_id",
  };
}
