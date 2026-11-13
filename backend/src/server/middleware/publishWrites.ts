import type { Request, Response, NextFunction } from "express";

import { publishWrite, recheckSessions } from "../../services/live-sync.service.js";

/**
 * Başarılı (2xx) her yazmayı yanıt GİTTİKTEN sonra canlı akışa yayınlar
 * (bkz. services/live-sync.service.ts). Handler'lar veritabanı işlemini yanıttan
 * önce bitirdiği için sinyali alan istemci yeni veriyi okur. Başarısız
 * yazmalar sinyal üretmez. requireAuth'tan sonra, router'lardan önce mount edilir.
 */
export function publishWrites(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }
  const path = req.originalUrl.split("?")[0];
  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    publishWrite(method, path);
    // Kullanıcı pasifleştirme / şifre sıfırlama / rol değişikliği: açık akışlar
    // dakikalık kontrolü beklemeden hemen yeniden doğrulansın.
    if (path === "/users" || path.startsWith("/users/")) {
      recheckSessions().catch((err) => {
        console.error("[live] oturum kontrolü başarısız:", err instanceof Error ? err.message : err);
      });
    }
  });
  next();
}
