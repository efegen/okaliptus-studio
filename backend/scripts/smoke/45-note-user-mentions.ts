/**
 * SMOKE 45 — Notlarda kullanıcı etiketi (migration 0290)
 *
 * Gövdede `@{u:<id>}` belirteci + note_user_mentions; görünen ad okuma anında
 * users.display_name'den çözülür (ad değişince güncellenir). Düzenleme etiketleri
 * değiştirir, var olmayan kullanıcı reddedilir, yanıtta etiket saklanır,
 * renderNoteBodyPlain belirteci "@Ad"a çevirir.
 *
 * ÇALIŞTIRMA: cd backend && npx tsx scripts/smoke/45-note-user-mentions.ts
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { createUser, updateUser } from "../../src/services/users.service.js";
import { renderNoteBodyPlain } from "../../src/services/note-text.js";
import { pool } from "../../src/db/connection.js";
import { section, assert, assertEqual, ok, fail, closePool, seedAdminUser } from "./_shared.js";

async function run(): Promise<void> {
  const admin = seedAdminUser();
  if (!admin) {
    section("SMOKE 45 — SKIPPED (BOOTSTRAP_ADMINS bulunamadı)");
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
    try { json = await r.json(); } catch { /* boş gövde */ }
    return { status: r.status, json };
  }

  const createdUserIds: string[] = [];
  const noteIds: string[] = [];
  const tokens: string[] = [];

  try {
    section("SMOKE 45 — Kullanıcı etiketi");
    const ownerRow = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [admin.username]);
    const ownerId = ownerRow.rows[0]?.id;
    if (!ownerId) { fail("owner satırı yok"); process.exit(1); }

    const ceren = await createUser(
      { username: "smoke45_ceren", displayName: "Ceren S45", password: "Smoke45Pass1", role: "assistant" }, ownerId);
    createdUserIds.push(ceren.id);

    const tokenOwner = await login(admin.username, admin.password);
    if (!tokenOwner) { fail("owner login başarısız"); process.exit(1); }
    tokens.push(tokenOwner);

    section("A — etiketli not: user_mentions döner, gövde belirteç taşır");
    const created = await req("POST", "/notes", tokenOwner, {
      body: `Merhaba @{u:${ceren.id}} bakar mısın`,
      mentionedUserIds: [ceren.id],
    });
    assertEqual(created.status, 201, "A: 201");
    noteIds.push(created.json.data.id);
    assertEqual(created.json.data.user_mentions.length, 1, "A: 1 kullanıcı etiketi");
    assertEqual(created.json.data.user_mentions[0].userId, String(ceren.id), "A: doğru kullanıcı");
    assertEqual(created.json.data.user_mentions[0].name, "Ceren S45", "A: güncel ad");
    assert(created.json.data.body.includes(`@{u:${ceren.id}}`), "A: gövde belirteç taşıyor");

    section("B — ad değişince etiket güncel adı gösterir");
    await updateUser(ceren.id, { displayName: "Ceren Yeni" }, ownerId);
    const list = await req("GET", "/notes", tokenOwner);
    const listed = list.json.data.find((n: any) => String(n.id) === String(noteIds[0]));
    assertEqual(listed?.user_mentions?.[0]?.name, "Ceren Yeni", "B: yeni ad yansıdı");
    assertEqual(await renderNoteBodyPlain(listed.body), "Merhaba @Ceren Yeni bakar mısın", "B: düz metin çözümü");

    section("C — yanıtta etiket saklanır");
    const reply = await req("POST", "/notes", tokenOwner, {
      body: `@{u:${ceren.id}} tamam`,
      parentNoteId: noteIds[0],
      mentionedUserIds: [ceren.id],
    });
    assertEqual(reply.status, 201, "C: yanıt 201");
    noteIds.push(reply.json.data.id);
    assertEqual(reply.json.data.user_mentions.length, 1, "C: yanıtta etiket");

    section("D — düzenleme etiketleri değiştirir");
    const edited = await req("PATCH", `/notes/${noteIds[0]}`, tokenOwner, { body: "Etiketsiz oldu", mentionedUserIds: [] });
    assertEqual(edited.status, 200, "D: 200");
    assertEqual(edited.json.data.user_mentions.length, 0, "D: etiket kalktı");

    section("E — var olmayan kullanıcı reddedilir");
    const bad = await req("POST", "/notes", tokenOwner, { body: "x @{u:999999999}", mentionedUserIds: ["999999999"] });
    assert(bad.status >= 400 && bad.status < 500, "E: 4xx");

    ok("\nSMOKE 45 — KULLANICI ETİKETİ TÜM ADIMLAR BAŞARILI ✓");
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
