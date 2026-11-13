// Canlı senkron (adım 2): başarılı yazmalardan sonra açık istemcilere
// "şu değişti" sinyali yollar (Server-Sent Events). Sinyal VERİ TAŞIMAZ —
// yalnız { method, path }. İstemci ilgili ekranları normal, yetkili GET'lerle
// yeniden çeker; yani rol kısıtları (asistan finans görmez) aynen korunur.
//
// Tek süreç varsayımı: yayın süreç içi (Railway'de tek kopya). Bildirim
// zamanlayıcısı ve kargo takibi de aynı varsayımla çalışıyor. İkinci kopya
// açılırsa sinyaller veritabanı üzerinden (LISTEN/NOTIFY) dağıtılmalı.
//
// Dayanıklılık:
//   - Her sinyal artan bir sıra numarası alır; son BUFFER_SIZE sinyal bellekte
//     tutulur. İstemci yeniden bağlanırken son gördüğü "<instance>:<seq>"
//     değerini (Last-Event-ID başlığı ya da ?since=) yollar → kaçırdıkları
//     tekrar oynatılır. Sunucu değişmişse (deploy/yeniden başlatma) ya da
//     tampon yetmezse hello.resumed=false döner → istemci ekranı baştan yeniler.
//   - 25 sn'de bir "ping" olayı: proxy'ler boşta bağlantıyı kesmesin, istemci
//     ölü bağlantıyı fark etsin (EventSource yorum satırlarını göremez, bu
//     yüzden gerçek olay).
//   - Oturum dakikada bir SALT-OKUMA kontrol edilir (süreyi uzatmaz); düşen
//     oturumun akışı kapanır, rol değişikliği filtreye yansır.
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";

import { pool } from "../db/connection.js";
import { can, isRole, type Capability, type Role } from "../auth/permissions.js";
import type { AuthUser } from "./auth.service.js";

export const LIVE_INSTANCE_ID = randomUUID().replace(/-/g, "").slice(0, 12);

const BUFFER_SIZE = 200;
const HEARTBEAT_MS = 25_000;
const SESSION_CHECK_MS = 60_000;
const RETRY_MS = 3_000;
const MAX_STREAMS_PER_USER = 3;
const MAX_STREAMS_TOTAL = 30;

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Signal = {
  seq: number;
  method: string;
  path: string;
  // null → tüm roller; aksi halde bu yetkiye sahip roller alır.
  capability: Capability | null;
};

type LiveClient = {
  id: number;
  userId: string;
  role: Role;
  token: string;
  res: Response;
  openedAt: number;
};

let seq = 0;
const buffer: Signal[] = [];
const clients = new Set<LiveClient>();
let nextClientId = 1;
let heartbeatTimer: NodeJS.Timeout | null = null;
let sessionTimer: NodeJS.Timeout | null = null;

function splitPath(path: string): string[] {
  return path.split(/[?#]/)[0].split("/").filter(Boolean);
}

/**
 * Bir yazmanın sinyal üretip üretmediği ve kimlerin alacağı.
 * undefined → sinyal yok (notlar, Trendyol, kullanıcılar, push, aktivite…:
 * kendi tazeleme akışları var ya da başka kullanıcının ekranını etkilemez).
 * İstemci tarafındaki eşleme: src/hooks/writeInvalidation.js — iki liste
 * birlikte güncellenmeli.
 */
export function signalCapability(method: string, path: string): Capability | null | undefined {
  if (!WRITE_METHODS.has(method.toUpperCase())) return undefined;
  const segments = splitPath(path);
  switch (segments[0]) {
    case "lessons":
    case "payments":
    case "packages":
    case "product-sales":
    case "students":
    case "calendar-events":
    case "settings":
    case "instructors":
    case "lesson-types":
    case "products":
      return null;
    case "channels":
    case "mapping":
    case "site-products":
      return "marketplace.manage";
    case "events":
      // Etkinlik günü (kapı) ekranı asistana kapalı.
      if (segments.includes("day") || segments[1] === "day-entries") return "events.day.read";
      return null;
    default:
      return undefined;
  }
}

function canReceive(client: LiveClient, signal: Signal): boolean {
  return signal.capability === null || can(client.role, signal.capability);
}

function writeTo(client: LiveClient, chunk: string): void {
  if (client.res.writableEnded || client.res.destroyed) {
    removeClient(client);
    return;
  }
  try {
    client.res.write(chunk);
  } catch {
    removeClient(client);
  }
}

function changeChunk(signal: Signal): string {
  return (
    `id: ${LIVE_INSTANCE_ID}:${signal.seq}\n` +
    `event: change\n` +
    `data: ${JSON.stringify({ seq: signal.seq, method: signal.method, path: signal.path })}\n\n`
  );
}

function removeClient(client: LiveClient): void {
  if (!clients.delete(client)) return;
  if (clients.size === 0) stopTimers();
}

function endClient(client: LiveClient): void {
  removeClient(client);
  if (!client.res.writableEnded) {
    try {
      client.res.end();
    } catch {
      /* zaten kapalı */
    }
  }
}

/** Başarılı bir yazmayı yayınlar (sinyal üretmeyen uçlarda hiçbir şey yapmaz). */
export function publishWrite(method: string, path: string): void {
  const capability = signalCapability(method, path);
  if (capability === undefined) return;
  seq += 1;
  const signal: Signal = {
    seq,
    method: method.toUpperCase(),
    path: path.split(/[?#]/)[0],
    capability,
  };
  buffer.push(signal);
  if (buffer.length > BUFFER_SIZE) buffer.shift();
  const chunk = changeChunk(signal);
  for (const client of [...clients]) {
    if (canReceive(client, signal)) writeTo(client, chunk);
  }
}

/** "<instance>:<seq>" → seq; başka sunucunun ya da bozuk değerse null. */
function parseSince(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const idx = raw.lastIndexOf(":");
  if (idx === -1 || raw.slice(0, idx) !== LIVE_INSTANCE_ID) return null;
  const n = Number(raw.slice(idx + 1));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** since'ten sonraki sinyaller tamponda eksiksiz duruyorsa onları döner. */
function replayAfter(since: number | null): Signal[] | null {
  if (since === null || since > seq) return null;
  const oldest = buffer.length > 0 ? buffer[0].seq : seq + 1;
  // since+1 tampondan düşmüşse arada kayıp var → yeniden oynatılamaz.
  if (since + 1 < oldest && since < seq) return null;
  return buffer.filter((s) => s.seq > since);
}

export function heartbeat(): void {
  const chunk = `event: ping\ndata: {}\n\n`;
  for (const client of [...clients]) writeTo(client, chunk);
}

/** Açık akışların oturumlarını SALT-OKUMA doğrular; rol değişikliğini uygular. */
export async function recheckSessions(): Promise<void> {
  if (clients.size === 0) return;
  const tokens = [...new Set([...clients].map((c) => c.token))];
  const result = await pool.query<{ token: string; role: string }>(
    `SELECT s.token, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ANY($1::text[])
        AND s.expires_at > now()
        AND u.is_active = true`,
    [tokens],
  );
  const roles = new Map(result.rows.map((r) => [r.token, r.role]));
  for (const client of [...clients]) {
    const role = roles.get(client.token);
    if (!role || !isRole(role)) {
      endClient(client);
    } else {
      client.role = role;
    }
  }
}

function startTimers(): void {
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
    heartbeatTimer.unref();
  }
  if (!sessionTimer) {
    sessionTimer = setInterval(() => {
      recheckSessions().catch((err) => {
        console.error("[live] oturum kontrolü başarısız:", err instanceof Error ? err.message : err);
      });
    }, SESSION_CHECK_MS);
    sessionTimer.unref();
  }
}

function stopTimers(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (sessionTimer) clearInterval(sessionTimer);
  heartbeatTimer = null;
  sessionTimer = null;
}

export type OpenStreamResult = "opened" | "too_many";

/**
 * SSE akışını açar. requireAuth'tan SONRA çağrılır (user + token doğrulanmış).
 * Yanıt açık kalır; istemci kapatınca ya da oturum düşünce temizlenir.
 */
export function openStream(req: Request, res: Response, user: AuthUser, token: string): OpenStreamResult {
  if (clients.size >= MAX_STREAMS_TOTAL) return "too_many";

  // Aynı kullanıcıda sınır aşılırsa EN ESKİ akış kapanır (iOS'ta arka planda
  // kalmış ölü bağlantılar yenisini engellemesin).
  const own = [...clients].filter((c) => c.userId === user.id).sort((a, b) => a.openedAt - b.openedAt);
  while (own.length >= MAX_STREAMS_PER_USER) {
    const oldest = own.shift();
    if (oldest) endClient(oldest);
  }

  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const client: LiveClient = {
    id: nextClientId++,
    userId: user.id,
    role: user.role,
    token,
    res,
    openedAt: Date.now(),
  };
  clients.add(client);
  startTimers();

  const sinceRaw = req.get("Last-Event-ID") ?? (typeof req.query.since === "string" ? req.query.since : undefined);
  const replay = replayAfter(parseSince(sinceRaw));

  let hello = `retry: ${RETRY_MS}\n`;
  hello += `id: ${LIVE_INSTANCE_ID}:${seq}\n`;
  hello += `event: hello\n`;
  hello += `data: ${JSON.stringify({ instance: LIVE_INSTANCE_ID, seq, resumed: replay !== null })}\n\n`;
  // hello'nun id'si istemcinin son görülen değerini günceller; tekrar oynatılan
  // sinyaller kendi id'leriyle onu ileri taşır. Bu yüzden hello önce gider ve
  // seq'i "şimdi"yi gösterir — tekrar oynatma since'ten başlar, hello'dan değil.
  writeTo(client, hello);
  if (replay) {
    for (const signal of replay) {
      if (canReceive(client, signal)) writeTo(client, changeChunk(signal));
    }
  }

  res.on("close", () => removeClient(client));
  return "opened";
}

/** Çıkış yapan oturumun akışlarını hemen kapatır. */
export function closeStreamsForToken(token: string): void {
  for (const client of [...clients]) {
    if (client.token === token) endClient(client);
  }
}

/** Kapanışta tüm akışları bitirir; istemciler yeni sunucuya yeniden bağlanır. */
export function closeAllStreams(): void {
  for (const client of [...clients]) endClient(client);
  stopTimers();
}

/** Teşhis/test için: açık akış sayısı. */
export function liveStreamCount(): number {
  return clients.size;
}
