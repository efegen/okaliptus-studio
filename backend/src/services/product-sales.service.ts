// Ref: §3.4, §2.1

import type { PoolClient } from "pg";

import { pool } from "../db/connection.js";
import {
  DeleteConflictError,
  LessonNotFoundError,
  PaymentTargetMismatchError,
  ProductSaleNotFoundError,
  StudentNotFoundError,
  ValidationError,
  toServiceError,
} from "./errors.js";
import {
  insertAuditLog,
  normalizeMoneyInput,
  normalizeOptionalText,
  rollbackQuietly,
  type EntityId,
  type MoneyInput,
} from "./shared.js";

type ProductSaleRow = {
  id: string;
  student_id: string;
  lesson_id: string | null;
  sold_at: string;
  total_amount: string;
  currency: string;
  note: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type ProductSaleBalanceRow = {
  product_sale_id: string;
  student_id: string;
  lesson_id: string | null;
  sold_at: string;
  total_amount: string;
  paid_amount: string;
  remaining_raw: string;
  remaining_receivable: string;
};

type StudentRow = {
  id: string;
  currency: string;
  deleted_at: string | null;
};

type LessonOwnershipRow = {
  id: string;
  student_id: string;
  deleted_at: string | null;
};

export type CreateProductSaleInput = {
  studentId: EntityId;
  soldAt: string;
  totalAmount: MoneyInput;
  note?: string | null;
  // Opsiyonel: ders tamamlama akışında verilen sale'i o derse bağlar.
  // NULL bırakılırsa standalone (ders dışı) satıştır.
  lessonId?: EntityId | null;
  actorUserId?: number | string | null;
};

export type UpdateProductSaleInput = {
  soldAt?: string;
  totalAmount?: MoneyInput;
  note?: string | null;
};

export async function getProductSaleById(
  productSaleId: EntityId,
): Promise<ProductSaleBalanceRow> {
  const result = await pool.query<ProductSaleBalanceRow>(
    `SELECT * FROM v_product_sale_balances WHERE product_sale_id = $1`,
    [productSaleId],
  );

  const sale = result.rows[0];
  if (!sale) throw new ProductSaleNotFoundError();
  return sale;
}

export async function listProductSalesForStudent(
  studentId: EntityId,
): Promise<ProductSaleBalanceRow[]> {
  const result = await pool.query<ProductSaleBalanceRow>(
    `SELECT * FROM v_product_sale_balances
     WHERE student_id = $1
     ORDER BY sold_at DESC, product_sale_id DESC`,
    [studentId],
  );
  return result.rows;
}

// Halihazırda açık bir transaction içinden çağrılır (örn. completeLesson). Kendi
// BEGIN/COMMIT'ini yönetmez; çağıran tarafın transaction'ı içinde çalışır.
// Bu sayede ders tamamlama + ürün satışı + ödeme tek atomik birim olur.
export async function createProductSaleWithClient(
  client: PoolClient,
  input: CreateProductSaleInput,
): Promise<ProductSaleRow> {
  const totalAmount = normalizeMoneyInput(input.totalAmount, "totalAmount");

  const studentResult = await client.query<StudentRow>(
    `SELECT id, currency, deleted_at FROM students WHERE id = $1 FOR UPDATE`,
    [input.studentId],
  );
  const student = studentResult.rows[0];
  if (!student || student.deleted_at !== null) throw new StudentNotFoundError();

  let lessonIdParam: string | null = null;
  if (input.lessonId !== undefined && input.lessonId !== null && input.lessonId !== "") {
    const lessonResult = await client.query<LessonOwnershipRow>(
      `SELECT id, student_id, deleted_at FROM lessons WHERE id = $1 FOR SHARE`,
      [input.lessonId],
    );
    const lesson = lessonResult.rows[0];
    if (!lesson || lesson.deleted_at !== null) {
      throw new LessonNotFoundError(
        "Linked lesson for product sale not found or deleted.",
      );
    }
    if (String(lesson.student_id) !== String(input.studentId)) {
      throw new PaymentTargetMismatchError(
        "Product sale lesson_id belongs to a different student than the sale.",
      );
    }
    lessonIdParam = String(lesson.id);
  }

  const insertResult = await client.query<ProductSaleRow>(
    `INSERT INTO product_sales (student_id, lesson_id, sold_at, total_amount, currency, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.studentId,
      lessonIdParam,
      input.soldAt,
      totalAmount,
      student.currency,
      normalizeOptionalText(input.note),
    ],
  );
  const sale = insertResult.rows[0];

  await insertAuditLog(client, {
    action: "product_sale_created",
    entityType: "product_sale",
    entityId: sale.id,
    after: sale,
    actorUserId: input.actorUserId ?? null,
  });

  return sale;
}

export async function createProductSale(
  input: CreateProductSaleInput,
): Promise<ProductSaleRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const sale = await createProductSaleWithClient(client, input);
    await client.query("COMMIT");
    return sale;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function updateProductSale(
  productSaleId: EntityId,
  input: UpdateProductSaleInput,
  actorUserId?: number | string | null,
): Promise<ProductSaleRow> {
  const client = await pool.connect();

  try {
    if (Object.keys(input).length === 0) {
      throw new ValidationError("At least one field is required.");
    }

    await client.query("BEGIN");

    const currentResult = await client.query<ProductSaleRow>(
      `SELECT * FROM product_sales WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [productSaleId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new ProductSaleNotFoundError();

    const before = { ...current };
    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.soldAt !== undefined) {
      values.push(input.soldAt);
      sets.push(`sold_at = $${values.length}`);
    }
    if (input.totalAmount !== undefined) {
      values.push(normalizeMoneyInput(input.totalAmount, "totalAmount"));
      sets.push(`total_amount = $${values.length}`);
    }
    if (input.note !== undefined) {
      values.push(normalizeOptionalText(input.note));
      sets.push(`note = $${values.length}`);
    }

    if (sets.length === 0) {
      await client.query("COMMIT");
      return current;
    }

    values.push(String(productSaleId));
    const updateResult = await client.query<ProductSaleRow>(
      `UPDATE product_sales SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    const updated = updateResult.rows[0];

    await insertAuditLog(client, {
      action: "product_sale_updated",
      entityType: "product_sale",
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

export async function softDeleteProductSale(productSaleId: EntityId, actorUserId?: number | string | null): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentResult = await client.query<ProductSaleRow>(
      `SELECT * FROM product_sales WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [productSaleId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new ProductSaleNotFoundError();

    // Tahsil edilmiş bir satış silinemez — önce ödeme(ler) iade edilmeli.
    // Aksi halde ledger ile satış kaydı arasında sessiz tutarsızlık oluşur.
    const paymentResult = await client.query<{ id: string }>(
      `SELECT id FROM payments WHERE product_sale_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [productSaleId],
    );
    if (paymentResult.rows[0]) {
      throw new DeleteConflictError(
        "Bu satışa bağlı ödeme var. Önce ödemeyi iade et / sil, sonra satışı kaldırabilirsin.",
      );
    }

    const before = { ...current };

    await client.query(
      `UPDATE product_sales SET deleted_at = now() WHERE id = $1`,
      [productSaleId],
    );

    await insertAuditLog(client, {
      action: "product_sale_deleted",
      entityType: "product_sale",
      entityId: String(productSaleId),
      before,
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}
