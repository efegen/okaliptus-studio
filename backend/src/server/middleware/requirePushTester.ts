import type { Request, Response, NextFunction } from "express";

import { env } from "../../config/env.js";

// Web Push TEST kilidi (izolasyonun 1. katmanı): yalnız .env'deki
// PUSH_TEST_USERNAME hesabı /push/* uçlarına erişebilir. Değer boş/unset ise
// özellik tamamen kapalıdır (herkes 403). Bu sayede test bildirimi başka bir
// admin hesabına sızamaz — yetkisiz hesap subscribe bile olamaz.
export function requirePushTester(req: Request, res: Response, next: NextFunction): void {
  const allowed = env.pushTestUsername;
  if (!allowed || req.currentUser?.username !== allowed) {
    res.status(403).json({
      error: { code: "PUSH_NOT_ALLOWED", message: "Bu özelliğe erişim yetkiniz yok." },
    });
    return;
  }
  next();
}
