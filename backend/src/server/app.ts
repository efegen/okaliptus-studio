import express from "express";

import { healthRouter } from "./routes/health.router.js";
import {
  studentsRouter,
  listStudentMovementsHandler,
} from "./routes/students.router.js";
import { lessonsRouter, listStudentLessonsHandler } from "./routes/lessons.router.js";
import { paymentsRouter } from "./routes/payments.router.js";
import { packagesRouter, listStudentPackagesHandler } from "./routes/packages.router.js";
import {
  productSalesRouter,
  listStudentProductSalesHandler,
} from "./routes/product-sales.router.js";
import { kpiRouter } from "./routes/kpi.router.js";
import { settingsRouter } from "./routes/settings.router.js";
import { instructorsRouter } from "./routes/instructors.router.js";
import { lessonTypesRouter } from "./routes/lesson-types.router.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  });
  app.use(express.json());

  // ── Top-level resource routers ─────────────────────────────────────────────
  app.use("/health", healthRouter);
  app.use("/lessons", lessonsRouter);
  app.use("/payments", paymentsRouter);
  app.use("/packages", packagesRouter);
  app.use("/product-sales", productSalesRouter);
  app.use("/kpi", kpiRouter);
  app.use("/settings", settingsRouter);
  app.use("/instructors", instructorsRouter);
  app.use("/lesson-types", lessonTypesRouter);
  app.use("/students", studentsRouter);

  // ── Student sub-resources (nested under /students/:studentId) ─────────────
  // These keep the :studentId param distinct from resource :id params.
  app.get("/students/:studentId/lessons", listStudentLessonsHandler);
  app.get("/students/:studentId/packages", listStudentPackagesHandler);
  app.get("/students/:studentId/product-sales", listStudentProductSalesHandler);
  app.get("/students/:studentId/movements", listStudentMovementsHandler);

  // ── Catch-all 404 ─────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found." } });
  });

  return app;
}
