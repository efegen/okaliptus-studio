import express from "express";

import { env } from "../config/env.js";
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
import { productsRouter, serveProductImageHandler } from "./routes/products.router.js";
import { channelsRouter } from "./routes/channels.router.js";
import { trendyolRouter } from "./routes/trendyol.router.js";
import { mappingRouter } from "./routes/mapping.router.js";
import { kpiRouter } from "./routes/kpi.router.js";
import { settingsRouter } from "./routes/settings.router.js";
import { instructorsRouter } from "./routes/instructors.router.js";
import { lessonTypesRouter } from "./routes/lesson-types.router.js";
import { authRouter } from "./routes/auth.router.js";
import { auditRouter } from "./routes/audit.router.js";
import { calendarEventsRouter } from "./routes/calendar-events.router.js";
import { movementsRouter } from "./routes/movements.router.js";
import { pushRouter } from "./routes/push.router.js";
import { usersRouter } from "./routes/users.router.js";
import { notificationSettingsRouter } from "./routes/notification-settings.router.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { requireCan } from "./middleware/requireRole.js";

export function createApp() {
  const app = express();

  // Railway's edge proxy adds X-Forwarded-For. Trust exactly one hop so
  // express-rate-limit can derive the real client IP without opening the
  // door to header spoofing (trust proxy: true would let any client forge it).
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && env.allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // OPTIONS preflight'tan ÖNCE set ediliyor; böylece görsel ucu dahil
    // tüm yanıtlara MIME-sniff koruması uygulanır.
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  });

  // CSRF koruması: durum değiştiren metotlarda Origin header'ı varsa whitelist'te
  // olmalı. Origin yoksa (same-origin veya tarayıcı-dışı istemci) geçişe izin
  // verilir. GET/HEAD güvenli kabul edilir, etkilenmez. OPTIONS preflight zaten
  // yukarıda 204 ile döndüğü için buraya ulaşmaz.
  app.use((req, res, next) => {
    if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
      const origin = req.headers.origin;
      if (origin && !env.allowedOrigins.includes(origin)) {
        res
          .status(403)
          .json({ error: { code: "CSRF_FORBIDDEN", message: "Geçersiz kaynak." } });
        return;
      }
    }
    next();
  });

  // Açık gövde limiti: mevcut JSON payload'lar küçük; görsel yüklemesi ayrı
  // express.raw (5mb) ucuyla gidiyor, bu yüzden 100kb fazlasıyla yeterli.
  app.use(express.json({ limit: "100kb" }));

  // ── Public routes (no auth required) ──────────────────────────────────────
  app.use("/health", healthRouter);
  app.use("/auth", authRouter);

  // Ürün görseli (salt-okuma): image_url'ler zaten public (0229). Auth gate'in
  // ÖNCESİNDE, böylece cross-site <img> third-party cookie engeline takılmaz.
  // Yazma (POST/DELETE /products/:id/image) authed router'da kalır.
  app.get("/products/:id/image", serveProductImageHandler);

  // ── Auth gate ─────────────────────────────────────────────────────────────
  app.use(requireAuth);

  // ── Protected resource routers ────────────────────────────────────────────
  // Asistana AÇIK olanlar (yalnız requireAuth): ders/ödeme/paket/ürün satışı,
  // ürün kataloğu, takvim, öğrenci (silme hariç), push abonelik.
  // İSTİSNA: bu router'ların DELETE'leri (payments/packages/product-sales) düzeltme
  // yolu → route-seviyesi requireCan("*.delete") ile asistana kapalı; POST/GET açık.
  app.use("/lessons", lessonsRouter);
  app.use("/payments", paymentsRouter);
  app.use("/packages", packagesRouter);
  app.use("/product-sales", productSalesRouter);
  app.use("/products", productsRouter);

  // Pazaryeri — asistana tamamen kapalı (okuma dahil). Mount-seviyesi kapı.
  app.use("/channels", requireCan("marketplace.manage"), channelsRouter);
  app.use("/trendyol", requireCan("marketplace.manage"), trendyolRouter);
  app.use("/mapping", requireCan("marketplace.manage"), mappingRouter);

  // KPI — karışık: /weekly + /occupancy-flow rol-bazlı alan soyar,
  // /finance-flow router içinde requireCan ile sert bloklu (asistan finansal görmez).
  app.use("/kpi", kpiRouter);

  // Ayarlar + katalog — GET açık (takvim saatleri, dropdown'lar), yazma router
  // içinde settings.manage ile kapılı.
  app.use("/settings", settingsRouter);
  app.use("/instructors", instructorsRouter);
  app.use("/lesson-types", lessonTypesRouter);

  // Denetim/etkinlik kayıtları — asistana kapalı (Ayarlar → Etkinlik).
  app.use("/audit-logs", requireCan("audit.read"), auditRouter);

  app.use("/users", usersRouter);

  // Bildirim ayar modülü — yalnız owner (kim ne bildirim alır, zamanlama, metin,
  // sessiz saatler). Scheduler bu tablodan okur.
  app.use("/notification-settings", requireCan("notifications.manage"), notificationSettingsRouter);

  app.use("/calendar-events", calendarEventsRouter);

  // Stüdyo geneli hareket akışı (finansal genel bakış) — asistana kapalı.
  // Öğrenci-bazlı hareketler (/students/:id/movements) ayrı handler, açık kalır.
  app.use("/movements", requireCan("movements.read"), movementsRouter);

  app.use("/push", pushRouter);
  app.use("/students", studentsRouter);

  // ── Student sub-resources (nested under /students/:studentId) ─────────────
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
