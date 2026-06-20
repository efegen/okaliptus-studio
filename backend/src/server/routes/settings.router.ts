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

    if ("lessonColorSaturation" in body) {
      const v = Number(body.lessonColorSaturation);
      if (!Number.isFinite(v)) throw new ValidationError("lessonColorSaturation geçersiz.");
      patch.lessonColorSaturation = v;
    }

    if ("stockTrackingEnabled" in body) {
      if (typeof body.stockTrackingEnabled !== "boolean") {
        throw new ValidationError("stockTrackingEnabled boolean olmalı.");
      }
      patch.stockTrackingEnabled = body.stockTrackingEnabled;
    }

    if ("marketplaceSyncEnabled" in body) {
      if (typeof body.marketplaceSyncEnabled !== "boolean") {
        throw new ValidationError("marketplaceSyncEnabled boolean olmalı.");
      }
      patch.marketplaceSyncEnabled = body.marketplaceSyncEnabled;
    }

    if ("marketplaceOrdersEnabled" in body) {
      if (typeof body.marketplaceOrdersEnabled !== "boolean") {
        throw new ValidationError("marketplaceOrdersEnabled boolean olmalı.");
      }
      patch.marketplaceOrdersEnabled = body.marketplaceOrdersEnabled;
    }

    if ("marketplaceStockPushEnabled" in body) {
      if (typeof body.marketplaceStockPushEnabled !== "boolean") {
        throw new ValidationError("marketplaceStockPushEnabled boolean olmalı.");
      }
      patch.marketplaceStockPushEnabled = body.marketplaceStockPushEnabled;
    }

    if ("marketplaceStockPushDryRun" in body) {
      if (typeof body.marketplaceStockPushDryRun !== "boolean") {
        throw new ValidationError("marketplaceStockPushDryRun boolean olmalı.");
      }
      patch.marketplaceStockPushDryRun = body.marketplaceStockPushDryRun;
    }

    if ("marketplaceFulfillmentEnabled" in body) {
      if (typeof body.marketplaceFulfillmentEnabled !== "boolean") {
        throw new ValidationError("marketplaceFulfillmentEnabled boolean olmalı.");
      }
      patch.marketplaceFulfillmentEnabled = body.marketplaceFulfillmentEnabled;
    }

    const data = await updateSettings(patch, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
