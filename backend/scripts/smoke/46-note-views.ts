/**
 * SMOKE 46 — Not / yanıt görüntülenme takibi (migration 0291)
 *
 * Görülme toplu bildirilir, tekrar bildirim ilk zamanı korur, yazar kendini
 * saymaz, seen_count/seen_by_me listede döner, görenler listesi yazarı hariç
 * tutar, silinmiş not ve geçersiz id sessizce atlanır.
 *
 * ÇALIŞTIRMA: cd backend && npx tsx scripts/smoke/46-note-views.ts
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { createUser } from "../../src/services/users.service.js";
import { pool } from "../../src/db/connection.js";
import { section, assert, assertEqual, ok, fail, closePool, seedAdminUser } from "./_shared.js";

async function run(): Promise<void> {
  const admin = seedAdminUser();
  if (!admin) {
    section("SMOKE 46 — SKIPPED (BOOTSTRAP_ADMINS bulunamadı)");
    await closePool();
    return;
  }

  const server: Server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function req(method: string, path: string, token: string, body?: unknown) {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    try { json = await r.json(); } catch { /* 204 */ }
    return { status: r.status, json };
  }

  const createdUserIds: string[] = [];
  const noteIds: string[] = [];
  const tokens: string[] = [];

  try {
    section("SMOKE 46 — Görüntülenme");
    const ownerRow = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [admin.username]);
    const ownerId = ownerRow.rows[0]?.id;
    if (!ownerId) { fail("owner satırı yok"); process.exit(1); }

    const ceren = await createUser(
      { username: "smoke46_ceren", displayName: "Ceren S46", password: "Smoke46Pass1", role: "assistant" }, ownerId);
    const deniz = await createUser(
      { username: "smoke46_deniz", displayName: "Deniz S46", password: "Smoke46Pass1", role: "assistant" }, ownerId);
    createdUserIds.push(ceren.id, deniz.id);

    const tokenOwner = await login(admin.username, admin.password);
    const tokenCeren = await login("smoke46_ceren", "Smoke46Pass1");
    const tokenDeniz = await login("smoke46_deniz", "Smoke46Pass1");
    if (!tokenOwner || !tokenCeren || !tokenDeniz) { fail("login başarısız"); process.exit(1); }
    tokens.push(tokenOwner, tokenCeren, tokenDeniz);

    const root = await req("POST", "/notes", tokenOwner, { body: "S46 kök not" });
    noteIds.push(root.json.data.id);
    const reply = await req("POST", "/notes", tokenCeren, { body: "S46 yanıt", parentNoteId: root.json.data.id });
    noteIds.push(reply.json.data.id);

    const findNote = async (token: string, id: string) =>
      (await req("GET", "/notes", token)).json.data.find((n: any) => String(n.id) === String(id));

    section("A — başlangıçta kimse görmemiş");
    const fresh = await findNote(tokenOwner, root.json.data.id);
    assertEqual(fresh.seen_count, 0, "A: seen_count 0");
    assertEqual(fresh.seen_by_me, false, "A: seen_by_me false");

    section("B — Ceren kök notu ve Deniz her iki notu görür");
    assertEqual((await req("POST", "/notes/views", tokenCeren, { noteIds: [root.json.data.id] })).status, 204, "B: 204");
    assertEqual((await req("POST", "/notes/views", tokenDeniz, { noteIds: [root.json.data.id, reply.json.data.id] })).status, 204, "B: 204 (Deniz)");
    const afterRoot = await findNote(tokenOwner, root.json.data.id);
    assertEqual(afterRoot.seen_count, 2, "B: kök not 2 kişi tarafından görüldü");
    assertEqual((await findNote(tokenCeren, root.json.data.id)).seen_by_me, true, "B: Ceren için seen_by_me true");
    assertEqual((await findNote(tokenOwner, root.json.data.id)).seen_by_me, false, "B: yazar için seen_by_me false");

    section("C — tekrar bildirim ilk zamanı korur, yazar kendini saymaz");
    const before = await pool.query(`SELECT first_seen_at FROM note_views WHERE note_id = $1 AND user_id = $2`, [root.json.data.id, ceren.id]);
    await req("POST", "/notes/views", tokenCeren, { noteIds: [root.json.data.id] });
    const again = await pool.query(`SELECT first_seen_at FROM note_views WHERE note_id = $1 AND user_id = $2`, [root.json.data.id, ceren.id]);
    assertEqual(String(again.rows[0].first_seen_at), String(before.rows[0].first_seen_at), "C: ilk görülme değişmedi");
    await req("POST", "/notes/views", tokenOwner, { noteIds: [root.json.data.id] });
    assertEqual((await findNote(tokenOwner, root.json.data.id)).seen_count, 2, "C: yazar sayıyı artırmadı");
    const replyCount = await findNote(tokenOwner, reply.json.data.id);
    assertEqual(replyCount.seen_count, 1, "C: yanıtı yalnız Deniz görmüş (yazar Ceren sayılmaz)");

    section("D — görenler listesi yazarı hariç tutar");
    const viewers = await req("GET", `/notes/${root.json.data.id}/views`, tokenDeniz);
    assertEqual(viewers.status, 200, "D: 200");
    assertEqual(viewers.json.data.length, 2, "D: 2 kişi");
    assert(viewers.json.data.every((v: any) => typeof v.name === "string" && v.seenAt), "D: ad ve zaman var");
    assert(!viewers.json.data.some((v: any) => String(v.userId) === String(ownerId)), "D: yazar listede yok");

    section("E — geçersiz girişler");
    assertEqual((await req("POST", "/notes/views", tokenCeren, { noteIds: ["abc", 999999999] })).status, 204, "E: geçersiz/olmayan id sessizce atlanır");
    assertEqual((await req("POST", "/notes/views", tokenCeren, { noteIds: "x" })).status, 400, "E: dizi değilse 400");
    assertEqual((await req("GET", "/notes/999999999/views", tokenCeren)).status, 404, "E: olmayan not 404");

    ok("\nSMOKE 46 — NOT GÖRÜNTÜLENME TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    for (const t of tokens) await logout(t).catch(() => undefined);
    if (noteIds.length > 0) {
      await pool.query(`DELETE FROM audit_logs WHERE entity_type = 'note' AND entity_id = ANY($1::bigint[])`, [noteIds]).catch(() => undefined);
      await pool.query(`DELETE FROM notes WHERE id = ANY($1::bigint[])`, [noteIds]).catch(() => undefined);
    }
    if (createdUserIds.length > 0) {
      await pool.query(`DELETE FROM audit_logs WHERE entity_id = ANY($1::bigint[]) AND entity_type='user'`, [createdUserIds]).catch(() => undefined);
      await pool.query(`DELETE FROM audit_logs WHERE actor_user_id = ANY($1::bigint[])`, [createdUserIds]).catch(() => undefined);
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
