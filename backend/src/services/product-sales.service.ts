// Ref: §3.4, §2.1
//
// v1.6: Sepet (cart) desteği. createProductSale artık opsiyonel `items` dizisi
// kabul eder. items verildiğinde:
//   - total_amount server-side hesaplanır (SUM(line_total))
//   - product_sale_items tablosuna her kalem yazılır
//   - Katalog ürünü için name/unit_price snapshot alınır (rapor immutable)
// items verilmediğinde eski davranış: client'ın gönderdiği totalAmount + note.
// Ders tamamlama akışı (lessons.service.ts) hâlâ totalAmount-only modda çalışır.

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
  centsToMoney,
  insertAuditLog,
  moneyToCents,
  normalizeMoneyInput,
  normalizeOptionalText,
  normalizeRequiredText,
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

export type ProductSaleItemRow = {
  id: string;
  sale_id: string;
  product_id: string | null;
  name_snapshot: string;
  unit_price_snapshot: string;
  quantity: number;
  line_total: string;
  created_at: string;
  image_url?: string | null;
};

export type ProductSaleWithItems = ProductSaleBalanceRow & {
  items: ProductSaleItemRow[];
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

type ProductCatalogRow = {
  id: string;
  name: string;
  price: string;
  archived_at: string | null;
};

export type CreateProductSaleItemInput = {
  productId?: EntityId | null;
  name?: string | null;
  unitPrice?: MoneyInput;
  quantity: number;
};

export type CreateProductSaleInput = {
  studentId: EntityId;
  soldAt: string;
  totalAmount?: MoneyInput;
  items?: CreateProductSaleItemInput[];
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
): Promise<ProductSaleWithItems> {
  const result = await pool.query<ProductSaleBalanceRow>(
    `SELECT * FROM v_product_sale_balances WHERE product_sale_id = $1`,
    [productSaleId],
  );

  const sale = result.rows[0];
  if (!sale) throw new ProductSaleNotFoundError();

  const items = await fetchSaleItems([sale.product_sale_id]);
  return { ...sale, items: items.get(sale.product_sale_id) ?? [] };
}

export async function listProductSalesForStudent(
  studentId: EntityId,
): Promise<ProductSaleWithItems[]> {
  const result = await pool.query<ProductSaleBalanceRow>(
    `SELECT * FROM v_product_sale_balances
     WHERE student_id = $1
     ORDER BY sold_at DESC, product_sale_id DESC`,
    [studentId],
  );
  if (result.rows.length === 0) return [];

  const ids = result.rows.map(r => r.product_sale_id);
  const items = await fetchSaleItems(ids);
  return result.rows.map(row => ({
    ...row,
    items: items.get(row.product_sale_id) ?? [],
  }));
}

async function fetchSaleItems(
  saleIds: string[],
): Promise<Map<string, ProductSaleItemRow[]>> {
  const map = new Map<string, ProductSaleItemRow[]>();
  if (saleIds.length === 0) return map;

  const result = await pool.query<ProductSaleItemRow>(
    `SELECT psi.id, psi.sale_id, psi.product_id, psi.name_snapshot, psi.unit_price_snapshot,
            psi.quantity, psi.line_total, psi.created_at, p.image_url
       FROM product_sale_items psi
       LEFT JOIN products p ON p.id = psi.product_id
      WHERE psi.sale_id = ANY($1::bigint[])
      ORDER BY psi.id ASC`,
    [saleIds],
  );

  for (const row of result.rows) {
    const list = map.get(row.sale_id);
    if (list) list.push(row);
    else map.set(row.sale_id, [row]);
  }
  return map;
}

// Sepet kalemlerini normalize eder, katalog ürünleri için snapshot alır,
// hem total amount'u (string) hem de DB insert için hazır kalemleri döner.
type ResolvedItem = {
  productId: string | null;
  nameSnapshot: string;
  unitPriceSnapshot: string;
  quantity: number;
  lineTotal: string;
};

async function resolveItems(
  client: PoolClient,
  items: CreateProductSaleItemInput[],
): Promise<{ resolved: ResolvedItem[]; total: string }> {
  if (items.length === 0) {
    throw new ValidationError("En az bir ürün kalemi gerekli.");
  }

  const productIds = items
    .map(it => it.productId)
    .filter((id): id is EntityId => id !== undefined && id !== null && id !== "");

  const productMap = new Map<string, ProductCatalogRow>();
  if (productIds.length > 0) {
    const result = await client.query<ProductCatalogRow>(
      `SELECT id, name, price, archived_at
         FROM products
        WHERE id = ANY($1::bigint[])
        FOR SHARE`,
      [productIds],
    );
    for (const row of result.rows) productMap.set(row.id, row);
  }

  const resolved: ResolvedItem[] = [];
  let totalCents = 0n;

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new ValidationError("Adet pozitif tam sayı olmalı.");
    }

    let productId: string | null = null;
    let name: string;
    let unitPrice: string;

    if (item.productId !== undefined && item.productId !== null && item.productId !== "") {
      const product = productMap.get(String(item.productId));
      if (!product) {
        throw new ValidationError(`Ürün bulunamadı (id=${item.productId}).`);
      }
      if (product.archived_at !== null) {
        throw new ValidationError(`Arşivlenmiş ürün satılamaz: ${product.name}`);
      }
      productId = product.id;
      name = product.name;
      unitPrice = product.price;
    } else {
      // Serbest kalem (katalog dışı) — name + unitPrice client'tan zorunlu.
      if (item.name === undefined || item.name === null) {
        throw new ValidationError("Katalog dışı kalem için isim zorunlu.");
      }
      if (item.unitPrice === undefined || item.unitPrice === null) {
        throw new ValidationError("Katalog dışı kalem için birim fiyat zorunlu.");
      }
      name = normalizeRequiredText(String(item.name), "name");
      unitPrice = normalizeMoneyInput(item.unitPrice, "unitPrice");
    }

    const unitCents = moneyToCents(unitPrice, "unitPrice");
    const lineCents = unitCents * BigInt(item.quantity);
    if (lineCents <= 0n) {
      throw new ValidationError("Satır toplamı sıfırdan büyük olmalı.");
    }
    const lineTotal = centsToMoney(lineCents);
    totalCents += lineCents;

    resolved.push({
      productId,
      nameSnapshot: name,
      unitPriceSnapshot: centsToMoney(unitCents),
      quantity: item.quantity,
      lineTotal,
    });
  }

  if (totalCents <= 0n) {
    throw new ValidationError("Toplam tutar sıfırdan büyük olmalı.");
  }

  return { resolved, total: centsToMoney(totalCents) };
}

// Halihazırda açık bir transaction içinden çağrılır (örn. completeLesson). Kendi
// BEGIN/COMMIT'ini yönetmez; çağıran tarafın transaction'ı içinde çalışır.
// Bu sayede ders tamamlama + ürün satışı + ödeme tek atomik birim olur.
export async function createProductSaleWithClient(
  client: PoolClient,
  input: CreateProductSaleInput,
): Promise<ProductSaleRow> {
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

  // İki mod: (a) items[] verildi → server-side hesapla, kalemler insert. (b) Geriye
  // dönük uyum: items yok, totalAmount geldi → tek satır toplam, kalem yok.
  let resolvedItems: ResolvedItem[] = [];
  let totalAmount: string;

  if (input.items && input.items.length > 0) {
    const result = await resolveItems(client, input.items);
    resolvedItems = result.resolved;
    totalAmount = result.total;
  } else {
    if (input.totalAmount === undefined || input.totalAmount === null) {
      throw new ValidationError("totalAmount veya items[] gerekli.");
    }
    totalAmount = normalizeMoneyInput(input.totalAmount, "totalAmount");
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

  for (const item of resolvedItems) {
    await client.query(
      `INSERT INTO product_sale_items (
         sale_id, product_id, name_snapshot, unit_price_snapshot, quantity, line_total
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sale.id,
        item.productId,
        item.nameSnapshot,
        item.unitPriceSnapshot,
        item.quantity,
        item.lineTotal,
      ],
    );
  }

  await insertAuditLog(client, {
    action: "product_sale_created",
    entityType: "product_sale",
    entityId: sale.id,
    after: { ...sale, items: resolvedItems },
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
