/**
 * SMOKE 47 — Canlı senkron akışı (GET /live, services/live-sync.service.ts)
 *
 * Başarılı yazma → açık akışlara "change" sinyali (veri yok, yalnız method+path).
 * Başarısız yazma ve sinyal dışı uçlar (aktivite ping'i) sinyal üretmez.
 * Rol süzgeci: pazaryeri ve etkinlik günü sinyalleri asistana gitmez.
 * Kaldığı yerden devam (Last-Event-ID / ?since=), başka sunucu ya da taşan
 * tampon → resumed=false. Kullanıcı başına akış sınırı, çıkış ve düşen oturum
 * akışı kapatır, ping olayı.
 *
 * ÇALIŞTIRMA: cd backend && npx tsx scripts/smoke/47-live-sync.ts
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { createUser } from "../../src/services/users.service.js";
import {
  LIVE_INSTANCE_ID,
  closeAllStreams,
  heartbeat,
  liveStreamCount,
  publishWrite,
  recheckSessions,
} from "../../src/services/live-sync.service.js";
import { pool } from "../../src/db/connection.js";
import { section, assert, assertEqual, ok, fail, closePool, cleanupSmoke, seedAdminUser } from "./_shared.js";

type SseEvent = { event: string; id: string | null; data: any };

type SseStream = {
  status: number;
  contentType: string;
  events: SseEvent[];
  isEnded: () => boolean;
  close: () => void;
  waitFor: (pred: (e: SseEvent) => boolean, ms?: number) => Promise<SseEvent | null>;
  waitEnded: (ms?: number) => Promise<boolean>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function run(): Promise<void> {
  const admin = seedAdminUser();
  if (!admin) {
    section("SMOKE 47 — SKIPPED (BOOTSTRAP_ADMINS bulunamadı)");
    await closePool();
    return;
  }

  const server: Server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function req(method: string, path: string, token: string, body?: unknown) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Cookie: `session=${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    try { json = await r.json(); } catch { /* 204 */ }
    return { status: r.status, json };
  }

  async function openSse(token: string | null, opts: { since?: string; lastEventId?: string } = {}): Promise<SseStream> {
    const ctrl = new AbortController();
    const headers: Record<string, string> = {};
    if (token) headers.Cookie = `session=${token}`;
    if (opts.lastEventId) headers["Last-Event-ID"] = opts.lastEventId;
    const qs = opts.since ? `?since=${encodeURIComponent(opts.since)}` : "";
    const r = await fetch(`${base}/live${qs}`, { headers, signal: ctrl.signal });
    const events: SseEvent[] = [];
    let ended = false;

    if (r.ok && r.body) {
      void (async () => {
        const reader = r.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf("\n\n")) !== -1) {
              const raw = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              let event = "message";
              let id: string | null = null;
              const dataLines: string[] = [];
              for (const line of raw.split("\n")) {
                if (line.startsWith("event: ")) event = line.slice(7);
                else if (line.startsWith("id: ")) id = line.slice(4);
                else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
              }
              if (dataLines.length > 0) events.push({ event, id, data: JSON.parse(dataLines.join("\n")) });
            }
          }
        } catch {
          /* abort */
        }
        ended = true;
      })();
    } else {
      ended = true;
    }

    return {
      status: r.status,
      contentType: r.headers.get("content-type") ?? "",
      events,
      isEnded: () => ended,
      close: () => ctrl.abort(),
      async waitFor(pred, ms = 2000) {
        const until = Date.now() + ms;
        while (Date.now() < until) {
          const hit = events.find(pred);
          if (hit) return hit;
          await sleep(10);
        }
        return events.find(pred) ?? null;
      },
      async waitEnded(ms = 2000) {
        const until = Date.now() + ms;
        while (Date.now() < until && !ended) await sleep(10);
        return ended;
      },
    };
  }

  const changes = (s: SseStream) => s.events.filter((e) => e.event === "change");
  const lastId = (s: SseStream) => [...s.events].reverse().find((e) => e.id)?.id ?? "";

  const createdUserIds: string[] = [];
  const createdStudentIds: string[] = [];
  const tokens: string[] = [];
  const streams: SseStream[] = [];

  try {
    section("SMOKE 47 — Canlı senkron akışı");
    const ownerRow = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [admin.username]);
    const ownerId = ownerRow.rows[0]?.id;
    if (!ownerId) { fail("owner satırı yok"); process.exit(1); }

    const asst = await createUser(
      { username: "smoke47_assistant", displayName: "S47 Assistant", password: "Smoke47Assist1", role: "assistant" },
      ownerId,
    );
    createdUserIds.push(asst.id);
    const tokenOwner = await login(admin.username, admin.password);
    const tokenAsst = await login("smoke47_assistant", "Smoke47Assist1");
    if (!tokenOwner || !tokenAsst) { fail("login başarısız"); process.exit(1); }
    tokens.push(tokenOwner, tokenAsst);

    section("A — girişsiz bağlantı reddedilir, girişli akış açılır");
    const anon = await openSse(null);
    assertEqual(anon.status, 401, "A: çerezsiz GET /live → 401");
    const owner = await openSse(tokenOwner);
    streams.push(owner);
    assertEqual(owner.status, 200, "A: owner akışı → 200");
    assert(owner.contentType.startsWith("text/event-stream"), "A: içerik türü text/event-stream");
    const hello = await owner.waitFor((e) => e.event === "hello");
    assert(hello !== null, "A: hello olayı geldi");
    assertEqual(hello?.data.instance, LIVE_INSTANCE_ID, "A: hello sunucu kimliğini taşır");
    assertEqual(hello?.data.resumed, false, "A: since yok → resumed=false");
    assertEqual(hello?.id, `${LIVE_INSTANCE_ID}:${hello?.data.seq}`, "A: hello id = <instance>:<seq>");
    const asstStream = await openSse(tokenAsst);
    streams.push(asstStream);
    assert((await asstStream.waitFor((e) => e.event === "hello")) !== null, "A: asistan akışı açıldı");

    section("B — başarılı yazma herkese sinyal olur, veri taşımaz");
    const created = await req("POST", "/students", tokenOwner, { fullName: "Smoke47 Öğrenci" });
    assertEqual(created.status, 201, "B: öğrenci oluşturuldu");
    const studentId = String(created.json.data.id);
    createdStudentIds.push(studentId);
    const ownerChange = await owner.waitFor((e) => e.event === "change" && e.data.path === "/students");
    const asstChange = await asstStream.waitFor((e) => e.event === "change" && e.data.path === "/students");
    assert(ownerChange !== null, "B: yazan kişinin akışına da geldi (istemci kendini atlar)");
    assert(asstChange !== null, "B: asistanın akışına geldi");
    assertEqual(asstChange?.data.method, "POST", "B: sinyal method taşır");
    assertEqual(Object.keys(asstChange?.data ?? {}).sort().join(","), "method,path,seq", "B: sinyalde yalnız seq/method/path var");

    section("C — başarısız yazma ve sinyal dışı uçlar sinyal üretmez");
    const before = changes(owner).length;
    const bad = await req("POST", "/students", tokenOwner, { fullName: "x", defaultLessonPrice: 1 });
    assertEqual(bad.status, 400, "C: hatalı gövde → 400");
    assertEqual((await req("POST", "/activity/ping", tokenOwner)).status, 204, "C: aktivite ping'i → 204");
    const patched = await req("PATCH", `/students/${studentId}`, tokenOwner, { nickname: "s47" });
    assertEqual(patched.status, 200, "C: işaret yazması (PATCH) → 200");
    const marker = await owner.waitFor((e) => e.event === "change" && e.data.path === `/students/${studentId}`);
    assert(marker !== null, "C: işaret sinyali geldi");
    assertEqual(changes(owner).length, before + 1, "C: arada başka sinyal yok (400 ve ping sessiz)");

    section("D — rol süzgeci");
    publishWrite("PUT", "/channels/999");
    publishWrite("POST", "/events/999/day/entries");
    publishWrite("POST", "/lessons");
    await owner.waitFor((e) => e.event === "change" && e.data.path === "/lessons" && e.data.seq > (marker?.data.seq ?? 0));
    await asstStream.waitFor((e) => e.event === "change" && e.data.path === "/lessons" && e.data.seq > (marker?.data.seq ?? 0));
    assert(changes(owner).some((e) => e.data.path === "/channels/999"), "D: owner pazaryeri sinyalini alır");
    assert(!changes(asstStream).some((e) => e.data.path === "/channels/999"), "D: asistan pazaryeri sinyalini almaz");
    assert(!changes(asstStream).some((e) => e.data.path === "/events/999/day/entries"), "D: asistan etkinlik günü sinyalini almaz");
    publishWrite("POST", "/notes");
    publishWrite("POST", "/trendyol/orders/sync");
    publishWrite("GET", "/students");
    publishWrite("POST", "/payments/cash");
    await owner.waitFor((e) => e.event === "change" && e.data.path === "/payments/cash");
    assert(!changes(owner).some((e) => ["/notes", "/trendyol/orders/sync"].includes(e.data.path)), "D: notlar/Trendyol sinyal üretmez");

    section("E — kaldığı yerden devam");
    const asstLastId = lastId(asstStream);
    asstStream.close();
    assert(await asstStream.waitEnded(), "E: asistan akışı kapandı");
    publishWrite("PATCH", "/settings");
    publishWrite("PUT", "/channels/998");
    publishWrite("DELETE", "/payments/77");
    const resumed = await openSse(tokenAsst, { lastEventId: asstLastId });
    streams.push(resumed);
    const helloResumed = await resumed.waitFor((e) => e.event === "hello");
    assertEqual(helloResumed?.data.resumed, true, "E: Last-Event-ID ile resumed=true");
    await resumed.waitFor((e) => e.event === "change" && e.data.path === "/payments/77");
    assertEqual(
      changes(resumed).map((e) => e.data.path).join(","),
      "/settings,/payments/77",
      "E: kaçırılanlar sırayla tekrar oynatıldı, pazaryeri süzüldü",
    );
    const viaQuery = await openSse(tokenAsst, { since: asstLastId });
    streams.push(viaQuery);
    assertEqual((await viaQuery.waitFor((e) => e.event === "hello"))?.data.resumed, true, "E: ?since= de çalışır");
    viaQuery.close();
    const foreign = await openSse(tokenAsst, { since: "baskasunucu:1" });
    streams.push(foreign);
    assertEqual((await foreign.waitFor((e) => e.event === "hello"))?.data.resumed, false, "E: başka sunucu → resumed=false");
    await sleep(50);
    assertEqual(changes(foreign).length, 0, "E: başka sunucuda tekrar oynatma yok");
    foreign.close();
    const staleId = lastId(resumed);
    for (let i = 0; i < 205; i++) publishWrite("POST", "/lessons");
    const tooOld = await openSse(tokenAsst, { since: staleId });
    streams.push(tooOld);
    assertEqual((await tooOld.waitFor((e) => e.event === "hello"))?.data.resumed, false, "E: tampon taştı → resumed=false");
    tooOld.close();
    resumed.close();

    section("F — kullanıcı başına akış sınırı (en eskisi kapanır)");
    const extra: SseStream[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await openSse(tokenOwner);
      streams.push(s);
      extra.push(s);
      await s.waitFor((e) => e.event === "hello");
    }
    assert(await owner.waitEnded(), "F: 4. akış açılınca en eski owner akışı kapandı");
    assert(extra.every((s) => !s.isEnded()), "F: yeni 3 akış açık");

    section("G — ping olayı");
    heartbeat();
    assert((await extra[2].waitFor((e) => e.event === "ping")) !== null, "G: ping geldi");

    section("H — çıkış ve düşen oturum akışı kapatır");
    const tokenAsst2 = await login("smoke47_assistant", "Smoke47Assist1");
    if (!tokenAsst2) { fail("H: login başarısız"); process.exit(1); }
    const toLogout = await openSse(tokenAsst2);
    streams.push(toLogout);
    await toLogout.waitFor((e) => e.event === "hello");
    await logout(tokenAsst2);
    assert(await toLogout.waitEnded(), "H: logout → akış hemen kapandı");
    const tokenAsst3 = await login("smoke47_assistant", "Smoke47Assist1");
    if (!tokenAsst3) { fail("H: login başarısız"); process.exit(1); }
    tokens.push(tokenAsst3);
    const toRevoke = await openSse(tokenAsst3);
    streams.push(toRevoke);
    await toRevoke.waitFor((e) => e.event === "hello");
    await pool.query(`DELETE FROM sessions WHERE token = $1`, [tokenAsst3]);
    await recheckSessions();
    assert(await toRevoke.waitEnded(), "H: silinen oturum → kontrol sonrası akış kapandı");
    assert(extra.every((s) => !s.isEnded()), "H: owner akışları etkilenmedi");

    ok("\nSMOKE 47 — CANLI SENKRON TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    for (const s of streams) s.close();
    closeAllStreams();
    await sleep(20);
    if (liveStreamCount() !== 0) fail(`kapanışta ${liveStreamCount()} akış açık kaldı`);
    for (const t of tokens) await logout(t).catch(() => undefined);
    await cleanupSmoke(createdStudentIds).catch(() => undefined);
    if (createdUserIds.length > 0) {
      await pool.query(`DELETE FROM audit_logs WHERE entity_id = ANY($1::bigint[]) AND entity_type='user'`, [createdUserIds]).catch(() => undefined);
      await pool.query(`DELETE FROM audit_logs WHERE actor_user_id = ANY($1::bigint[])`, [createdUserIds]).catch(() => undefined);
      await pool.query(`DELETE FROM sessions WHERE user_id = ANY($1::bigint[])`, [createdUserIds]).catch(() => undefined);
      await pool.query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [createdUserIds]).catch(() => undefined);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
