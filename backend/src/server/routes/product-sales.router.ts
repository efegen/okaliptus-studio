// Ref: §3.4
import { Router } from "express";

import {
  createProductSale,
  getProductSaleById,
  listProductSalesForStudent,
  softDeleteProductSale,
  updateProductSale,
} from "../../services/product-sales.service.js";
import { sendError, parseId } from "../middleware/response.js";

export const productSalesRouter = Router();

// POST /product-sales
// lessonId opsiyonel — ders tamamlama akışı dışında (standalone alışveriş) NULL
// gelir. Verildiğinde sale o derse bağlanır ve ders takviminde simgelenir.
productSalesRouter.post("/", async (req, res) => {
  try {
    const { studentId, soldAt, totalAmount, note, lessonId } =
      req.body as Record<string, unknown>;

    const data = await createProductSale({
      studentId: studentId as string | number,
      soldAt: String(soldAt ?? ""),
      totalAmount: totalAmount as string | number,
      note: note != null ? String(note) : null,
      lessonId:
        lessonId != null && lessonId !== ""
          ? (lessonId as string | number)
          : null,
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

// PATCH /product-sales/:id
productSalesRouter.patch("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const { soldAt, totalAmount, note } = req.body as Record<string, unknown>;

    const data = await updateProductSale(id, {
      ...(soldAt !== undefined && { soldAt: String(soldAt) }),
      ...(totalAmount !== undefined && { totalAmount: totalAmount as string | number }),
      ...(note !== undefined && { note: note != null ? String(note) : null }),
    });
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /product-sales/:id
productSalesRouter.delete("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    await softDeleteProductSale(id);
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
