// Ref: §4.1–§4.7
import { Router } from "express";

import { getWeeklyKpi, getFinanceFlow, getOccupancyFlow } from "../../services/kpi.service.js";
import { sendError } from "../middleware/response.js";
import { requireCan } from "../middleware/requireRole.js";
import { can } from "../../auth/permissions.js";

export const kpiRouter = Router();

// Etap 2 — asistan finansal veri görmez. /weekly ve /occupancy-flow tamamen
// bloklanmaz (operasyonel alanlar — ders sayısı, doluluk, yoklama — asistana
// gerekli); yalnız FİNANSAL alanlar `finance.read` yoksa yanıttan soyulur.

// /weekly'nin operasyonel (finansal olmayan) alt kümesi. Ciro/tahsilat/alacak/
// aktif kredi ve aylık/30g finansal toplamlar çıkarılır; ders sayıları, doluluk
// oranı ve öğrenci sayıları korunur.
function stripWeeklyFinance(data: Awaited<ReturnType<typeof getWeeklyKpi>>) {
  return {
    weekStart: data.weekStart,
    weekEnd: data.weekEnd,
    lessonCounts: data.lessonCounts,
    occupancyRatio: data.occupancyRatio,
    debtorStudentCount: data.debtorStudentCount,
    totalStudentCount: data.totalStudentCount,
    activeStudentCount: data.activeStudentCount,
  };
}

// /occupancy-flow'daki her kovadan yalnız `revenue` (ders cirosu) alanını çıkarır;
// doluluk %, planlı/tamamlanan/iptal sayıları ve roster korunur. Kovayı açıkça
// yeniden kurar (destructuring-omit yerine) — kullanılmayan yerel değişken yok.
function stripOccupancyRevenue(data: Awaited<ReturnType<typeof getOccupancyFlow>>) {
  const stripBucket = (b: (typeof data)["week"]["series"][number]) => ({
    start: b.start,
    planned: b.planned,
    completed: b.completed,
    cancelled: b.cancelled,
    pct: b.pct,
    current: b.current,
  });
  return {
    ...data,
    week: { series: data.week.series.map(stripBucket) },
    month: { series: data.month.series.map(stripBucket) },
  };
}

// GET /kpi/weekly
kpiRouter.get("/weekly", async (req, res) => {
  try {
    const data = await getWeeklyKpi();
    if (!can(req.currentUser.role, "finance.read")) {
      res.json({ data: stripWeeklyFinance(data) });
      return;
    }
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /kpi/finance-flow — mobil "Finans · Akış" ekranının yapısal verisi
// (hafta/ay zaman serisi + kasa girişi + kaynak dökümü). Tamamen finansal →
// asistana sert bloklu.
kpiRouter.get("/finance-flow", requireCan("finance.read"), async (_req, res) => {
  try {
    const data = await getFinanceFlow();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /kpi/occupancy-flow — mobil "Doluluk · Yoklama" ekranının yapısal verisi
// (hafta/ay % doluluk serisi + ders cirosu/iptal + temposu düşenler tablosu).
// Asistan ekranı görebilir; yalnız ders cirosu (revenue) alanları soyulur.
kpiRouter.get("/occupancy-flow", async (req, res) => {
  try {
    const data = await getOccupancyFlow();
    if (!can(req.currentUser.role, "finance.read")) {
      res.json({ data: stripOccupancyRevenue(data) });
      return;
    }
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
