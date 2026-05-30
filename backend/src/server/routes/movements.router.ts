import { Router } from "express";

import { sendError } from "../middleware/response.js";
import {
  listStudioMovements,
  type StudioMovementTypeFilter,
} from "../../services/movements.service.js";

export const movementsRouter = Router();

const VALID_TYPES: readonly string[] = ["all", "sale", "lesson", "payment"];

// GET /movements — stüdyo geneli hareket akışı.
// Query params: from, to (ISO), type (all|sale|lesson|payment), q (öğrenci adı
// ILIKE), page, limit. Yanıt: { data, page, limit, hasMore, summary }.
movementsRouter.get("/", async (req, res) => {
  try {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;

    const rawType = String(req.query.type ?? "all");
    const type: StudioMovementTypeFilter = VALID_TYPES.includes(rawType)
      ? (rawType as StudioMovementTypeFilter)
      : "all";

    const result = await listStudioMovements({
      from: req.query.from ? String(req.query.from) : null,
      to: req.query.to ? String(req.query.to) : null,
      type,
      q: req.query.q ? String(req.query.q) : null,
      limit,
      offset,
    });

    res.json({
      data: result.data,
      page,
      limit,
      hasMore: result.hasMore,
      summary: result.summary,
    });
  } catch (err) {
    sendError(res, err);
  }
});
