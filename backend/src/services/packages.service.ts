import { pool } from "../db/connection.js";
import {
  OverpaymentOnPrepaidPackageError,
  PackageHasUsedCreditsError,
  PaymentNotFoundError,
  PrepaidPackageNotFoundError,
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
  type PaymentSource,
} from "./shared.js";

type StudentRow = {
  id: string;
  currency: string;
  deleted_at: string | null;
};

type PrepaidPackageRow = {
  id: string;
  student_id: string;
  purchased_at: string;
  credit_count: number;
  unit_price: string;
  total_amount: string;
  currency: string;
  note: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
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

type PrepaidPackageStatusRow = {
  package_id: string;
  student_id: string;
  purchased_at: string;
  credit_count: number;
  unit_price: string;
  total_amount: string;
  used_credits: string;
  remaining_credits: string;
  remaining_value: string;
};

export type CreatePrepaidPackageInput = {
  studentId: EntityId;
  purchasedAt: string;
  creditCount: number;
  unitPrice: EntityId;
  totalAmount: EntityId;
  source: Extract<PaymentSource, "cash" | "iban">;
  note?: string | null;
  paymentNote?: string | null;
};

export async function getPrepaidPackageById(packageId: EntityId): Promise<PrepaidPackageRow> {
  const result = await pool.query<PrepaidPackageRow>(
    `
      SELECT *
      FROM prepaid_packages
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [packageId],
  );

  const pkg = result.rows[0];

  if (!pkg) {
    throw new PrepaidPackageNotFoundError();
  }

  return pkg;
}

export async function getPrepaidPackageStatus(
  packageId: EntityId,
): Promise<PrepaidPackageStatusRow> {
  const result = await pool.query<PrepaidPackageStatusRow>(
    `
      SELECT *
      FROM v_prepaid_package_status
      WHERE package_id = $1
    `,
    [packageId],
  );

  const status = result.rows[0];

  if (!status) {
    throw new PrepaidPackageNotFoundError();
  }

  return status;
}

export async function listStudentPackageStatuses(
  studentId: EntityId,
): Promise<PrepaidPackageStatusRow[]> {
  const result = await pool.query<PrepaidPackageStatusRow>(
    `
      SELECT *
      FROM v_prepaid_package_status
      WHERE student_id = $1
      ORDER BY purchased_at ASC, package_id ASC
    `,
    [studentId],
  );

  return result.rows;
}

export async function createPrepaidPackage(
  input: CreatePrepaidPackageInput,
): Promise<{ prepaidPackage: PrepaidPackageRow; payment: PaymentRow }> {
  const client = await pool.connect();

  try {
    if (!Number.isInteger(input.creditCount) || input.creditCount <= 0) {
      throw new ValidationError("creditCount must be a positive integer.");
    }

    if (input.source !== "cash" && input.source !== "iban") {
      throw new ValidationError("source must be either 'cash' or 'iban'.");
    }

    const unitPrice = normalizeMoneyInput(input.unitPrice, "unitPrice", { allowZero: true });
    const totalAmount = normalizeMoneyInput(input.totalAmount, "totalAmount");
    const expectedTotal = BigInt(input.creditCount) * moneyToCents(unitPrice, "unitPrice");

    if (moneyToCents(totalAmount, "totalAmount") !== expectedTotal) {
      throw new OverpaymentOnPrepaidPackageError(
        "Prepaid package total_amount must equal credit_count × unit_price.",
      );
    }

    await client.query("BEGIN");

    const studentResult = await client.query<StudentRow>(
      `
        SELECT id, currency, deleted_at
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

    const packageResult = await client.query<PrepaidPackageRow>(
      `
        INSERT INTO prepaid_packages (
          student_id,
          purchased_at,
          credit_count,
          unit_price,
          total_amount,
          currency,
          note
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        input.studentId,
        input.purchasedAt,
        input.creditCount,
        unitPrice,
        centsToMoney(expectedTotal),
        student.currency,
        normalizeOptionalText(input.note),
      ],
    );

    const prepaidPackage = packageResult.rows[0];

    const paymentResult = await client.query<PaymentRow>(
      `
        INSERT INTO payments (
          paid_at,
          amount,
          currency,
          source,
          prepaid_package_id,
          note
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [
        input.purchasedAt,
        prepaidPackage.total_amount,
        student.currency,
        input.source,
        prepaidPackage.id,
        normalizeOptionalText(input.paymentNote),
      ],
    );

    const payment = paymentResult.rows[0];

    await insertAuditLog(client, {
      action: "prepaid_package_created",
      entityType: "prepaid_package",
      entityId: prepaidPackage.id,
      after: prepaidPackage,
    });

    await insertAuditLog(client, {
      action: "payment_created",
      entityType: "payment",
      entityId: payment.id,
      after: payment,
    });

    await client.query("COMMIT");
    return { prepaidPackage, payment };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function deletePrepaidPackage(packageId: EntityId): Promise<{
  prepaidPackage: PrepaidPackageRow;
  payment: PaymentRow;
}> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const packageResult = await client.query<PrepaidPackageRow>(
      `
        SELECT *
        FROM prepaid_packages
        WHERE id = $1
        FOR UPDATE
      `,
      [packageId],
    );

    const pkg = packageResult.rows[0];

    if (!pkg || pkg.deleted_at !== null) {
      throw new PrepaidPackageNotFoundError("Package not found or already deleted.");
    }

    const usedLessonsResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM lessons
        WHERE prepaid_package_id = $1
          AND status = 'completed'
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [packageId],
    );

    if (usedLessonsResult.rows.length > 0) {
      throw new PackageHasUsedCreditsError(
        "Package has used credits. Soft-delete affected lessons first.",
      );
    }

    const paymentResult = await client.query<PaymentRow>(
      `
        SELECT *
        FROM payments
        WHERE prepaid_package_id = $1
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [packageId],
    );

    const payment = paymentResult.rows[0];

    if (!payment) {
      throw new PaymentNotFoundError(
        "Active payment not found for prepaid package. Invariant violated.",
      );
    }

    const beforePackage = { ...pkg };
    const beforePayment = { ...payment };

    const deletedPackageResult = await client.query<PrepaidPackageRow>(
      `
        UPDATE prepaid_packages
        SET deleted_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [packageId],
    );

    const deletedPaymentResult = await client.query<PaymentRow>(
      `
        UPDATE payments
        SET deleted_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [payment.id],
    );

    const deletedPackage = deletedPackageResult.rows[0];
    const deletedPayment = deletedPaymentResult.rows[0];

    await insertAuditLog(client, {
      action: "prepaid_package_deleted",
      entityType: "prepaid_package",
      entityId: deletedPackage.id,
      before: beforePackage,
    });

    await insertAuditLog(client, {
      action: "payment_deleted",
      entityType: "payment",
      entityId: deletedPayment.id,
      before: beforePayment,
      note: `Deleted atomically with package #${packageId}`,
    });

    await client.query("COMMIT");
    return { prepaidPackage: deletedPackage, payment: deletedPayment };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}
