import { Router } from "express";

import {
  listNotificationSettings,
  updateNotificationSetting,
  sendTestNotification,
} from "../../services/notification-settings.service.js";
import { sendError } from "../middleware/response.js";

// Bildirim ayar modülü — yalnız owner (`requireCan("notifications.manage")` mount
// noktasında, app.ts). Kim hangi bildirimi alır, zamanlama, metin, sessiz saatler.
export const notificationSettingsRouter = Router();

// GET /notification-settings — tüm türler + '_global' (sessiz saatler).
notificationSettingsRouter.get("/", async (_req, res) => {
  try {
    const data = await listNotificationSettings();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /notification-settings/:key — enabled / recipientUserIds / config.
notificationSettingsRouter.patch("/:key", async (req, res) => {
  try {
    const body = req.body as {
      enabled?: unknown;
      recipientUserIds?: unknown;
      config?: unknown;
    };
    const patch: Parameters<typeof updateNotificationSetting>[1] = {};
    if ("enabled" in body) patch.enabled = body.enabled as boolean;
    if ("recipientUserIds" in body) patch.recipientUserIds = body.recipientUserIds as Array<number | string>;
    if ("config" in body) patch.config = body.config as Record<string, unknown>;

    const data = await updateNotificationSetting(String(req.params.key), patch);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /notification-settings/:key/test — çağıran kullanıcıya örnek bildirim
// gönderir. Yanıt { sent } = ulaşılan cihaz sayısı (0 → abonelik yok).
notificationSettingsRouter.post("/:key/test", async (req, res) => {
  try {
    const sent = await sendTestNotification(String(req.params.key), req.currentUser.id);
    res.json({ data: { sent } });
  } catch (err) {
    sendError(res, err);
  }
});
