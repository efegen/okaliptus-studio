import { Router } from "express";

import { getSettings, updateSettings } from "../../services/settings.service.js";
import { sendError } from "../middleware/response.js";
import { ValidationError } from "../../services/errors.js";

export const settingsRouter = Router();

// GET /settings
settingsRouter.get("/", async (_req, res) => {
  try {
    const data = await getSettings();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /settings
settingsRouter.patch("/", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;

    const patch: Parameters<typeof updateSettings>[0] = {};

    if ("weeklyCapacity" in body) {
      const v = Number(body.weeklyCapacity);
      if (!Number.isFinite(v)) throw new ValidationError("weeklyCapacity geçersiz.");
      patch.weeklyCapacity = v;
    }

    if ("calendarStartHour" in body) {
      const v = Number(body.calendarStartHour);
      if (!Number.isFinite(v)) throw new ValidationError("calendarStartHour geçersiz.");
      patch.calendarStartHour = v;
    }

    if ("calendarEndHour" in body) {
      const v = Number(body.calendarEndHour);
      if (!Number.isFinite(v)) throw new ValidationError("calendarEndHour geçersiz.");
      patch.calendarEndHour = v;
    }

    if ("defaultLessonDuration" in body) {
      const v = Number(body.defaultLessonDuration);
      if (!Number.isFinite(v)) throw new ValidationError("defaultLessonDuration geçersiz.");
      patch.defaultLessonDuration = v;
    }

    if ("defaultLessonMode" in body) {
      const v = String(body.defaultLessonMode);
      if (v !== "online" && v !== "onsite") {
        throw new ValidationError("defaultLessonMode 'online' veya 'onsite' olmalı.");
      }
      patch.defaultLessonMode = v;
    }

    if ("paymentMethodCash" in body) {
      patch.paymentMethodCash = Boolean(body.paymentMethodCash);
    }

    if ("paymentMethodIban" in body) {
      patch.paymentMethodIban = Boolean(body.paymentMethodIban);
    }

    if ("lessonColorSaturation" in body) {
      const v = Number(body.lessonColorSaturation);
      if (!Number.isFinite(v)) throw new ValidationError("lessonColorSaturation geçersiz.");
      patch.lessonColorSaturation = v;
    }

    const data = await updateSettings(patch, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
