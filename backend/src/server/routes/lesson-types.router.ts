import { Router } from "express";

import {
  listAllLessonTypes,
  createLessonType,
  updateLessonType,
  listLessonTypeStudentPrices,
  setLessonTypeStudentPrice,
  removeLessonTypeStudentPrice,
} from "../../services/lesson-types.service.js";
import { parseId, sendError } from "../middleware/response.js";

export const lessonTypesRouter = Router();

// GET /lesson-types
lessonTypesRouter.get("/", async (_req, res) => {
  try {
    const data = await listAllLessonTypes();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /lesson-types
lessonTypesRouter.post("/", async (req, res) => {
  try {
    const { name, default_duration_minutes, default_price } = req.body as {
      name?: unknown;
      default_duration_minutes?: unknown;
      default_price?: unknown;
    };

    if (typeof name !== "string" || name.trim() === "") {
      res.status(400).json({ error: { message: "name zorunlu." } });
      return;
    }
    const durationMin = Number(default_duration_minutes);
    if (!Number.isFinite(durationMin) || durationMin <= 0 || durationMin > 240) {
      res.status(400).json({ error: { message: "default_duration_minutes 1–240 arasında olmalı." } });
      return;
    }
    const price = Number(default_price);
    if (!Number.isFinite(price) || price < 0) {
      res.status(400).json({ error: { message: "default_price geçersiz." } });
      return;
    }

    const data = await createLessonType({
      name: name.trim(),
      default_duration_minutes: durationMin,
      default_price: price,
    }, req.currentUser.id);
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /lesson-types/:id
lessonTypesRouter.patch("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body as {
      name?: unknown;
      default_duration_minutes?: unknown;
      default_price?: unknown;
      is_active?: unknown;
    };

    const patch: Parameters<typeof updateLessonType>[1] = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim() === "") {
        res.status(400).json({ error: { message: "name boş olamaz." } });
        return;
      }
      patch.name = body.name.trim();
    }
    if (body.default_duration_minutes !== undefined) {
      const d = Number(body.default_duration_minutes);
      if (!Number.isFinite(d) || d <= 0 || d > 240) {
        res.status(400).json({ error: { message: "default_duration_minutes 1–240 arasında olmalı." } });
        return;
      }
      patch.default_duration_minutes = d;
    }
    if (body.default_price !== undefined) {
      const p = Number(body.default_price);
      if (!Number.isFinite(p) || p < 0) {
        res.status(400).json({ error: { message: "default_price geçersiz." } });
        return;
      }
      patch.default_price = p;
    }
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") {
        res.status(400).json({ error: { message: "is_active boolean olmalı." } });
        return;
      }
      patch.is_active = body.is_active;
    }

    const data = await updateLessonType(id, patch, req.currentUser.id);
    if (!data) {
      res.status(404).json({ error: { message: "Ders türü bulunamadı." } });
      return;
    }
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /lesson-types/:id/prices — ders türüne özel fiyatlı öğrenciler
lessonTypesRouter.get("/:id/prices", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await listLessonTypeStudentPrices(id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /lesson-types/:id/prices/:studentId — öğrenciye özel fiyat ayarla (upsert)
// (PATCH; CORS izinli metotlar GET/POST/PATCH/DELETE — PUT tarayıcıda bloke olur)
lessonTypesRouter.patch("/:id/prices/:studentId", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const studentId = parseId(req.params.studentId);
    const { custom_price } = req.body as { custom_price?: unknown };

    const price = Number(custom_price);
    if (!Number.isFinite(price) || price < 0) {
      res.status(400).json({ error: { message: "custom_price geçersiz." } });
      return;
    }

    const data = await setLessonTypeStudentPrice(
      id,
      studentId,
      price,
      req.currentUser.id,
    );
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /lesson-types/:id/prices/:studentId — özel fiyatı kaldır
lessonTypesRouter.delete("/:id/prices/:studentId", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const studentId = parseId(req.params.studentId);
    const removed = await removeLessonTypeStudentPrice(
      id,
      studentId,
      req.currentUser.id,
    );
    if (!removed) {
      res.status(404).json({ error: { message: "Özel fiyat bulunamadı." } });
      return;
    }
    res.json({ data: { removed: true } });
  } catch (err) {
    sendError(res, err);
  }
});
