// Ref: §5.3, §5.4, §5.9
import { Router } from "express";

import {
  createCashPayment,
  deletePayment,
  getPaymentById,
} from "../../services/payments.service.js";
import type { PaymentTargetType } from "../../services/shared.js";
import { requireCan } from "../middleware/requireRole.js";
import { sendError, parseId } from "../middleware/response.js";

export const paymentsRouter = Router();

// POST /payments/cash
paymentsRouter.post("/cash", async (req, res) => {
  try {
    const { targetType, targetId, amount, source, paidAt, note } =
      req.body as Record<string, unknown>;

    const data = await createCashPayment({
      targetType: String(targetType ?? "") as PaymentTargetType,
      targetId: targetId as string | number,
      amount: amount as string | number,
      source: String(source ?? "") as "cash" | "iban",
      paidAt: String(paidAt ?? ""),
      note: note != null ? String(note) : null,
      actorUserId: req.currentUser.id,
    });
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /payments/:id
paymentsRouter.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await getPaymentById(id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /payments/:id — düzeltme yolu, yalnız payments.delete (asistan hariç).
paymentsRouter.delete("/:id", requireCan("payments.delete"), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await deletePayment(id, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
