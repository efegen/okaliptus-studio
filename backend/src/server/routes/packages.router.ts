// Ref: §5.5, §5.9b
import { Router } from "express";

import {
  createPrepaidPackage,
  deletePrepaidPackage,
  getPrepaidPackageStatus,
  listStudentPackageStatuses,
} from "../../services/packages.service.js";
import type { PaymentSource } from "../../services/shared.js";
import { sendError, parseId } from "../middleware/response.js";

export const packagesRouter = Router();

// POST /packages
packagesRouter.post("/", async (req, res) => {
  try {
    const { studentId, purchasedAt, creditCount, unitPrice, totalAmount, source, note, paymentNote } =
      req.body as Record<string, unknown>;

    const data = await createPrepaidPackage({
      studentId: studentId as string | number,
      purchasedAt: String(purchasedAt ?? ""),
      creditCount: Number(creditCount),
      unitPrice: unitPrice as string | number,
      totalAmount: totalAmount as string | number,
      source: String(source ?? "") as Extract<PaymentSource, "cash" | "iban">,
      note: note != null ? String(note) : null,
      paymentNote: paymentNote != null ? String(paymentNote) : null,
    });
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /packages/:id
packagesRouter.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await getPrepaidPackageStatus(id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /packages/:id
packagesRouter.delete("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await deletePrepaidPackage(id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /students/:studentId/packages — handler exported for use in students sub-router
export async function listStudentPackagesHandler(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  try {
    const studentId = parseId(req.params.studentId);
    const data = await listStudentPackageStatuses(studentId);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
}
