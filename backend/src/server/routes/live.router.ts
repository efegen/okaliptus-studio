import type { Request, Response } from "express";

import { extractSessionToken } from "../middleware/requireAuth.js";
import { openStream } from "../../services/live-sync.service.js";

/**
 * GET /live — canlı senkron akışı (text/event-stream). requireAuth'tan sonra
 * mount edilir; tüm roller bağlanır, sinyaller rol bazlı süzülür.
 * Kaldığı yerden devam: Last-Event-ID başlığı ya da ?since=<instance>:<seq>.
 */
export function liveStreamHandler(req: Request, res: Response): void {
  const token = extractSessionToken(req.headers.cookie);
  if (!token) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Authentication required." } });
    return;
  }
  const result = openStream(req, res, req.currentUser, token);
  if (result === "too_many") {
    res.status(503).json({
      error: { code: "LIVE_STREAM_LIMIT", message: "Çok fazla canlı bağlantı açık, biraz sonra tekrar dene." },
    });
  }
}
