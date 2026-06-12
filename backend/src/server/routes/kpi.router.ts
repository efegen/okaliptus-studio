// Ref: §4.1–§4.7
import { Router } from "express";

import { getWeeklyKpi, getFinanceFlow, getOccupancyFlow } from "../../services/kpi.service.js";
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

// GET /kpi/finance-flow — mobil "Finans · Akış" ekranının yapısal verisi
// (hafta/ay zaman serisi + kasa girişi + kaynak dökümü).
kpiRouter.get("/finance-flow", async (_req, res) => {
  try {
    const data = await getFinanceFlow();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /kpi/occupancy-flow — mobil "Doluluk · Yoklama" ekranının yapısal verisi
// (hafta/ay % doluluk serisi + ders cirosu/iptal + temposu düşenler tablosu).
kpiRouter.get("/occupancy-flow", async (_req, res) => {
  try {
    const data = await getOccupancyFlow();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
