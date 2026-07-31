// Ref: §3.4
import { Router } from "express";

import {
  createProductSale,
  getProductSaleById,
  listProductSalesForStudent,
  softDeleteProductSale,
} from "../../services/product-sales.service.js";
import { requireCan } from "../middleware/requireRole.js";
import { sendError, parseId } from "../middleware/response.js";

export const productSalesRouter = Router();

// POST /product-sales
// lessonId opsiyonel — ders tamamlama akışı dışında (standalone alışveriş) NULL
// gelir. Verildiğinde sale o derse bağlanır ve ders takviminde simgelenir.
//
// items[] (v1.6): sepet kalemleri. Verildiğinde server-side total hesaplanır;
// client'tan gelen totalAmount yok sayılır. items boş geçilirse legacy mod
// (sadece totalAmount + note) çalışır — ders tamamlama gibi eski entegrasyonlar
// için.
productSalesRouter.post("/", async (req, res) => {
  try {
    const { studentId, soldAt, totalAmount, note, lessonId, items } =
      req.body as Record<string, unknown>;

    const parsedItems = Array.isArray(items)
      ? items.map((raw, idx) => {
          const it = raw as Record<string, unknown>;
          if (it.quantity === undefined || it.quantity === null) {
            throw Object.assign(new Error(`items[${idx}].quantity zorunlu.`), {
              statusCode: 400,
              code: "VALIDATION_ERROR",
            });
          }
          return {
            productId:
              it.productId != null && it.productId !== ""
                ? (it.productId as string | number)
                : null,
            name: it.name != null ? String(it.name) : null,
            unitPrice:
              it.unitPrice != null
                ? (it.unitPrice as string | number)
                : undefined,
            quantity: Number(it.quantity),
          };
        })
      : undefined;

    const data = await createProductSale({
      studentId: studentId as string | number,
      soldAt: String(soldAt ?? ""),
      totalAmount:
        totalAmount != null ? (totalAmount as string | number) : undefined,
      items: parsedItems,
      note: note != null ? String(note) : null,
      lessonId:
        lessonId != null && lessonId !== ""
          ? (lessonId as string | number)
          : null,
      actorUserId: req.currentUser.id,
    });
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /product-sales/:id
productSalesRouter.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await getProductSaleById(id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /product-sales/:id — düzeltme yolu, yalnız sales.delete (asistan hariç).
// Satış silinince düşülen stok defterden geri okunup iade edilir (servis katmanı).
// (PATCH /product-sales/:id kaldırıldı: kısmi düzenleme snapshot invariantını ve
//  overpayment korumasını deliyordu; düzeltme modeli = sil + yeniden oluştur.)
productSalesRouter.delete("/:id", requireCan("sales.delete"), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    await softDeleteProductSale(id, req.currentUser.id);
    res.json({ data: null });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /students/:studentId/product-sales — handler exported for use in students sub-router
export async function listStudentProductSalesHandler(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  try {
    const studentId = parseId(req.params.studentId);
    const data = await listProductSalesForStudent(studentId);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
}
