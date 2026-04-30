// Ref: §4.1–§4.7
import { Router } from "express";

import { getWeeklyKpi } from "../../services/kpi.service.js";
import { sendError } from "../middleware/response.js";

export const kpiRouter = Router();

// GET /kpi/weekly
kpiRouter.get("/weekly", async (_req, res) => {
  try {
    const data = await getWeeklyKpi();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
