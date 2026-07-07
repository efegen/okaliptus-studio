import { Router } from "express";

import { env } from "../../config/env.js";
import { requireCan } from "../middleware/requireRole.js";
import { sendError } from "../middleware/response.js";
import { ValidationError } from "../../services/errors.js";
import {
  saveSubscription,
  removeSubscription,
  sendToUser,
  type PushPayload,
} from "../../services/push.service.js";

export const pushRouter = Router();

// /config, /subscribe, /unsubscribe HER ROLE açık (yalnız requireAuth, app.ts'te
// zaten global) — Etap 4: instructor/admin de kendi cihazında abone olabilmeli ki
// notification-scheduler'ın gönderdiği bildirimler onlara ulaşsın. Her uç zaten
// yalnız req.currentUser.id ile scope'lu (saveSubscription/removeSubscription/
// sendToUser) — çapraz kullanıcı riski yok. Yalnız /test (deploy-test özelliği)
// owner'a kilitli kalır.

// GET /push/config — frontend'in subscribe için ihtiyaç duyduğu VAPID public key.
// Aynı zamanda gate görevi görür: 200 dönerse istemci kartı gösterir, 403/503 ise
// gizler. VAPID anahtarı yoksa özellik tamamen kapalı (503).
pushRouter.get("/config", (_req, res) => {
  if (!env.vapidPublicKey) {
    res.status(503).json({ error: { code: "PUSH_NOT_CONFIGURED", message: "Push yapılandırılmamış." } });
    return;
  }
  res.json({ data: { vapidPublicKey: env.vapidPublicKey } });
});

// POST /push/subscribe — aboneliği o an giriş yapmış kullanıcıya bağlar.
pushRouter.post("/subscribe", async (req, res) => {
  try {
    const body = req.body as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    };
    const endpoint = body?.endpoint;
    const p256dh = body?.keys?.p256dh;
    const auth = body?.keys?.auth;

    if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
      throw new ValidationError("Geçersiz abonelik verisi.");
    }

    const ua = req.headers["user-agent"];
    await saveSubscription(
      req.currentUser.id,
      { endpoint, keys: { p256dh, auth } },
      typeof ua === "string" ? ua : null,
    );
    res.status(201).json({ data: { ok: true } });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /push/unsubscribe — yalnız çağıranın kendi endpoint'ini siler.
pushRouter.post("/unsubscribe", async (req, res) => {
  try {
    const endpoint = (req.body as { endpoint?: unknown })?.endpoint;
    if (typeof endpoint !== "string") throw new ValidationError("endpoint gerekli.");
    await removeSubscription(req.currentUser.id, endpoint);
    res.json({ data: { ok: true } });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /push/test — deploy-test özelliği, owner-only (requireCan). İZOLASYON
// 2. katman: body'de HEDEF YOK. Yalnız çağıranın kendi cihazlarına gönderir.
// uid istek anında senkron yakalanır; gecikmeli gönderimde bile sabittir →
// başka kullanıcıya sapma imkânsız.
pushRouter.post("/test", requireCan("push.test"), async (req, res) => {
  try {
    const raw = Number((req.body as { delaySeconds?: unknown })?.delaySeconds ?? 0);
    const delaySeconds = Number.isFinite(raw) ? Math.min(60, Math.max(0, Math.trunc(raw))) : 0;
    const uid = req.currentUser.id;

    const payload: PushPayload = {
      title: "Okaliptus — Test",
      body:
        delaySeconds > 0
          ? `Bu ${delaySeconds} sn gecikmeli bir test bildirimidir.`
          : "Bu bir test bildirimidir.",
      url: "/",
    };

    if (delaySeconds === 0) {
      // Hemen: sonucu (kaç cihaza gittiğini) bekleyip döndür ki istemci teyit etsin.
      const sent = await sendToUser(uid, payload);
      res.json({ data: { sent } });
    } else {
      // Gecikmeli: istek 202 ile hemen döner, kullanıcı uygulamayı kapatabilir.
      // setTimeout callback'i kendi hatasını yutar (process'i düşürmez).
      setTimeout(() => {
        sendToUser(uid, payload).catch((e: unknown) =>
          console.error("[push] delayed test send error:", (e as Error)?.message),
        );
      }, delaySeconds * 1000);
      res.status(202).json({ data: { scheduled: true, delaySeconds } });
    }
  } catch (err) {
    sendError(res, err);
  }
});
