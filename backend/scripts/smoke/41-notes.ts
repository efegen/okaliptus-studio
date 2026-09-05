/**
 * SMOKE 41 — Notlar (stüdyo geneli tek not akışı)
 *
 * (migration 0268 → 0270 → 0273 → 0275) Notlar önce etkinliğe bağlıydı (SMOKE
 * 40'ın "R" bölümü), 0273'te genel bir alana dönüştü: tek liste, etkinlik
 * referansı yok. 0275 tepki ve fotoğraf yan tablolarını ekledi.
 * Kapsam: ekleme, sıralama, düzenleme, silme (soft-delete), tek seviye yanıt,
 * "@" ile öğrenci bahsi, yazar kısıtı, emoji tepkileri, fotoğraf ve /notes
 * HTTP router'ı.
 *
 * Not: liste stüdyo geneli olduğu için önceki koşuların notları da döner —
 * doğrulamalar bu koşuda üretilen id'lere göre süzülür.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/41-notes.ts
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { createStudent } from "../../src/services/students.service.js";
import {
  addNote,
  deleteNote,
  getNoteImage,
  listNotes,
  setNoteImage,
  toggleNoteReaction,
  updateNote,
} from "../../src/services/notes.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  assert,
  assertEqual,
  assertRejects,
  ok,
  fail,
  closePool,
  cleanupSmoke,
  seedAdminUser,
  getActorUserId,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const noteIds: string[] = [];

  async function cleanupNotes(): Promise<void> {
    if (noteIds.length === 0) return;
    await pool.query(`DELETE FROM note_mentions WHERE note_id = ANY($1::bigint[])`, [noteIds]);
    // Yanıtlar üst nottan önce silinmeli (parent_note_id FK).
    await pool.query(`DELETE FROM notes WHERE id = ANY($1::bigint[]) AND parent_note_id IS NOT NULL`, [noteIds]);
    await pool.query(`DELETE FROM notes WHERE id = ANY($1::bigint[])`, [noteIds]);
  }

  try {
    section("SMOKE 41 — Notlar modülü");

    const actorUserId = await getActorUserId();
    if (!actorUserId) {
      ok("A: aktif kullanıcı yok (BOOTSTRAP_ADMINS?), Notlar testi atlandı");
      return;
    }

    const actorDisplayName = (
      await pool.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id = $1`, [actorUserId])
    ).rows[0].display_name;
    // "Başkasının notu" testleri için ikinci bir aktif kullanıcı arıyoruz —
    // yoksa (tek admin ortamı) forbidden testleri atlanır, çökmez.
    const secondActorRow = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE is_active = true AND id <> $1 ORDER BY id ASC LIMIT 1`,
      [actorUserId],
    );
    const secondActorUserId = secondActorRow.rows[0] ? Number(secondActorRow.rows[0].id) : null;

    const studentA = await createStudent({ fullName: "SMOKE41 Ada Bahis" });
    studentIds.push(studentA.id);
    const studentB = await createStudent({ fullName: "SMOKE41 Deniz Bahis" });
    studentIds.push(studentB.id);

    // ── A. Ekleme + sıralama ─────────────────────────────────────────────────
    section("A — addNote / listNotes: ekleme, doğrulama, sıralama");
    await assertRejects(
      () => addNote({ body: "   ", actorUserId }),
      "VALIDATION_ERROR",
      "A: boş/whitespace not reddedilir",
    );

    const noteFirst = await addNote({ body: "SMOKE41 Malzemeler bahçede hazır.", actorUserId });
    noteIds.push(noteFirst.id);
    assertEqual(noteFirst.author_name, actorDisplayName, "A: not, yazarın users.display_name'iyle JOIN'lenmiş döner");
    assertEqual(noteFirst.body, "SMOKE41 Malzemeler bahçede hazır.", "A: not metni aynen kaydedilir");
    assertEqual(noteFirst.parent_note_id, null, "A: üst seviye not parent_note_id=null");
    assertEqual(noteFirst.deleted_at, null, "A: yeni not silinmemiş");
    assertEqual(noteFirst.mentions.length, 0, "A: bahis vermeden eklenen notta mentions boş");

    const noteSecond = await addNote({ body: "SMOKE41 Hava durumu güncellendi, çadır lazım.", actorUserId });
    noteIds.push(noteSecond.id);

    // Herkes görebilir: listNotes yazara göre filtrelemez — bu yüzden ayrı bir
    // "başka kullanıcı görebiliyor mu" testi yok, WHERE zaten yok.
    const notesList = await listNotes(actorUserId);
    const mine = notesList.filter((n) => n.id === noteFirst.id || n.id === noteSecond.id);
    assertEqual(mine.length, 2, "A: her iki not da genel listede");
    assertEqual(mine[0].id, noteSecond.id, "A: en yeni not daha üstte (created_at DESC)");
    assertEqual(mine[1].id, noteFirst.id, "A: en eski not daha altta");

    // ── B. "@" ile öğrenci bahsi ─────────────────────────────────────────────
    section("B — @ bahis: geçerli/geçersiz öğrenci referansı");
    const noteWithMention = await addNote({
      body: `@${studentA.full_name} bugün gelmiyor.`,
      actorUserId,
      mentionedStudentIds: [studentA.id],
    });
    noteIds.push(noteWithMention.id);
    assertEqual(noteWithMention.mentions.length, 1, "B: bahis kaydedildi");
    assertEqual(noteWithMention.mentions[0].studentId, studentA.id, "B: bahsedilen öğrenci id doğru");
    assertEqual(noteWithMention.mentions[0].name, studentA.full_name, "B: bahis adı sorgu anında students'tan JOIN'lenir");

    await assertRejects(
      () => addNote({ body: "Yok olan birinden bahis.", actorUserId, mentionedStudentIds: ["999999999"] }),
      "STUDENT_NOT_FOUND",
      "B: var olmayan öğrenciye bahis reddedilir",
    );

    // ── C. Düzenleme: yalnız yazar, mentions tamamen değişir ─────────────────
    section("C — updateNote: yalnız yazar düzenleyebilir");
    const editedNote = await updateNote(noteFirst.id, {
      body: "SMOKE41 Malzemeler bahçede hazır, çadır da kuruldu.",
      actorUserId,
      mentionedStudentIds: [studentB.id],
    });
    assertEqual(editedNote.body, "SMOKE41 Malzemeler bahçede hazır, çadır da kuruldu.", "C: gövde güncellendi");
    assertEqual(editedNote.mentions.length, 1, "C: mentions tamamen yenisiyle değişti");
    assertEqual(editedNote.mentions[0].studentId, studentB.id, "C: yeni bahis studentB");
    assert(editedNote.updated_at !== editedNote.created_at, "C: updated_at artık created_at'ten farklı");

    await assertRejects(
      () => updateNote(noteFirst.id, { body: "  ", actorUserId }),
      "VALIDATION_ERROR",
      "C: boş/whitespace düzenleme reddedilir",
    );
    await assertRejects(
      () => updateNote("999999999", { body: "Yok.", actorUserId }),
      "NOTE_NOT_FOUND",
      "C: var olmayan not düzenlenemez",
    );
    if (secondActorUserId) {
      await assertRejects(
        () => updateNote(noteFirst.id, { body: "Başkası düzenlemeye çalışıyor.", actorUserId: secondActorUserId }),
        "NOTE_FORBIDDEN",
        "C: başka kullanıcı notu düzenleyemez",
      );
    } else {
      ok("C: ikinci aktif kullanıcı yok, forbidden-düzenleme testi atlandı");
    }

    // ── D. Yanıt: tek seviye ─────────────────────────────────────────────────
    section("D — Yanıt: tek seviyeyle sınırlı");
    const reply = await addNote({
      body: "SMOKE41 Çadırı kim getiriyor?",
      actorUserId,
      parentNoteId: noteSecond.id,
    });
    noteIds.push(reply.id);
    assertEqual(reply.parent_note_id, noteSecond.id, "D: yanıt parent_note_id'yi taşır");

    await assertRejects(
      () => addNote({ body: "Yanıta yanıt.", actorUserId, parentNoteId: reply.id }),
      "VALIDATION_ERROR",
      "D: bir yanıta yanıt verilemez (tek seviye)",
    );
    await assertRejects(
      () => addNote({ body: "Yok olan nota yanıt.", actorUserId, parentNoteId: "999999999" }),
      "NOTE_NOT_FOUND",
      "D: var olmayan nota yanıt verilemez",
    );

    // ── E. Emoji tepkisi + fotoğraf ─────────────────────────────────────────
    section("E — Tepki toggle ve ayrı saklanan not fotoğrafı");
    const reacted = await toggleNoteReaction(noteFirst.id, "👍", actorUserId);
    assertEqual(reacted.reactions.length, 1, "E: ilk tepki grubu oluştu");
    assertEqual(reacted.reactions[0].count, 1, "E: tepki adedi 1");
    assertEqual(reacted.reactions[0].reactedByMe, true, "E: kendi tepkim işaretli");

    if (secondActorUserId) {
      const seenByOther = await listNotes(secondActorUserId);
      const otherView = seenByOther.find((n) => n.id === noteFirst.id)!;
      assertEqual(otherView.reactions[0].reactedByMe, false, "E: başka kullanıcı tepkiyi kendisinin sanmaz");
    }

    const unreacted = await toggleNoteReaction(noteFirst.id, "👍", actorUserId);
    assertEqual(unreacted.reactions.length, 0, "E: aynı emojiye ikinci dokunuş tepkiyi kaldırır");
    await assertRejects(
      () => toggleNoteReaction(noteFirst.id, "🚫", actorUserId),
      "VALIDATION_ERROR",
      "E: izin verilmeyen emoji reddedilir",
    );

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const noteWithImage = await setNoteImage(noteFirst.id, "image/png", pngBytes, actorUserId);
    assertEqual(noteWithImage.has_image, true, "E: fotoğraf yüklenince has_image=true");
    assert(!!noteWithImage.image_updated_at, "E: görsel cache sürümü döner");
    const storedImage = await getNoteImage(noteFirst.id);
    assertEqual(storedImage?.mime, "image/png", "E: görsel MIME korunur");
    assertEqual(storedImage?.bytes.length, pngBytes.length, "E: görsel bytes ayrı tablodan okunur");

    // ── F. Silme: soft-delete, yanıt zinciri kopmaz ──────────────────────────
    section("F — deleteNote: soft-delete, yalnız yazar silebilir");
    if (secondActorUserId) {
      await assertRejects(
        () => deleteNote(noteSecond.id, secondActorUserId),
        "NOTE_FORBIDDEN",
        "F: başka kullanıcı notu silemez",
      );
    } else {
      ok("F: ikinci aktif kullanıcı yok, forbidden-silme testi atlandı");
    }

    await deleteNote(noteSecond.id, actorUserId);
    const afterDelete = await listNotes(actorUserId);
    const deletedRow = afterDelete.find((n) => n.id === noteSecond.id)!;
    assertEqual(deletedRow.body, null, "F: silinen notun gövdesi null döner");
    assert(deletedRow.deleted_at !== null, "F: deleted_at dolduruldu");
    const replyStillThere = afterDelete.find((n) => n.id === reply.id);
    assert(!!replyStillThere, "F: üst not silinince yanıt zinciri kopmaz, yanıt listede kalır");

    await assertRejects(
      () => deleteNote(noteSecond.id, actorUserId),
      "NOTE_NOT_FOUND",
      "F: zaten silinmiş not ikinci kez silinemez",
    );
    await assertRejects(
      () => updateNote(noteSecond.id, { body: "Silindikten sonra düzenleme.", actorUserId }),
      "NOTE_NOT_FOUND",
      "F: silinmiş not düzenlenemez",
    );
    await assertRejects(
      () => addNote({ body: "Silinmiş nota yanıt.", actorUserId, parentNoteId: noteSecond.id }),
      "NOTE_NOT_FOUND",
      "F: silinmiş nota yanıt verilemez",
    );

    // ── G. HTTP router ───────────────────────────────────────────────────────
    section("G — /notes HTTP router bağlı ve erişilebilir (tüm roller açık)");
    const admin = seedAdminUser();
    if (!admin) {
      ok("G: BOOTSTRAP_ADMINS yok, HTTP kontrolü atlandı (servis katmanı zaten doğrulandı)");
    } else {
      const server: Server = createServer(createApp());
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as AddressInfo).port;
      const base = `http://127.0.0.1:${port}`;
      const token = await login(admin.username, admin.password);
      try {
        if (!token) {
          fail("G: login başarısız");
          process.exit(1);
        }

        const postRes = await fetch(`${base}/notes`, {
          method: "POST",
          headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ body: "SMOKE41 HTTP üzerinden eklenen not." }),
        });
        assertEqual(postRes.status, 201, "G: POST /notes → 201");
        const postBody = await postRes.json();
        noteIds.push(postBody.data.id);
        assertEqual(postBody.data.body, "SMOKE41 HTTP üzerinden eklenen not.", "G: POST yanıtı eklenen notu döner");

        const reactionRes = await fetch(`${base}/notes/${postBody.data.id}/reactions`, {
          method: "POST",
          headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ emoji: "❤️" }),
        });
        assertEqual(reactionRes.status, 200, "G: POST /notes/:noteId/reactions → 200");
        const reactionBody = await reactionRes.json();
        assertEqual(reactionBody.data.reactions[0].emoji, "❤️", "G: HTTP tepki yanıta yansır");

        const imagePostRes = await fetch(`${base}/notes/${postBody.data.id}/image`, {
          method: "POST",
          headers: { Cookie: `session=${token}`, "Content-Type": "image/png" },
          body: pngBytes,
        });
        assertEqual(imagePostRes.status, 200, "G: POST /notes/:noteId/image → 200");
        const imagePostBody = await imagePostRes.json();
        assertEqual(imagePostBody.data.has_image, true, "G: HTTP fotoğraf yüklemesi has_image döner");

        const imageGetRes = await fetch(`${base}/notes/${postBody.data.id}/image`, {
          headers: { Cookie: `session=${token}` },
        });
        assertEqual(imageGetRes.status, 200, "G: GET /notes/:noteId/image → 200");
        assertEqual(imageGetRes.headers.get("content-type"), "image/png", "G: fotoğraf MIME doğru servis edilir");
        assertEqual((await imageGetRes.arrayBuffer()).byteLength, pngBytes.length, "G: fotoğraf bytes eksiksiz servis edilir");

        const listRes = await fetch(`${base}/notes`, { headers: { Cookie: `session=${token}` } });
        assertEqual(listRes.status, 200, "G: GET /notes → 200");
        const listBody = await listRes.json();
        assert(
          listBody.data.some((n: { id: string }) => n.id === postBody.data.id),
          "G: GET listesi HTTP üzerinden eklenen notu içeriyor — herkes görebilir",
        );

        const patchRes = await fetch(`${base}/notes/${postBody.data.id}`, {
          method: "PATCH",
          headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ body: "SMOKE41 HTTP üzerinden düzenlenen not." }),
        });
        assertEqual(patchRes.status, 200, "G: PATCH /notes/:noteId → 200");
        const patchBody = await patchRes.json();
        assertEqual(patchBody.data.body, "SMOKE41 HTTP üzerinden düzenlenen not.", "G: PATCH yanıtı güncellenen gövdeyi döner");

        const deleteRes = await fetch(`${base}/notes/${postBody.data.id}`, {
          method: "DELETE",
          headers: { Cookie: `session=${token}` },
        });
        assertEqual(deleteRes.status, 200, "G: DELETE /notes/:noteId → 200");
      } finally {
        if (token) await logout(token).catch(() => undefined);
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }

    ok("\nSMOKE 41 — NOTLAR MODÜLÜ TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    await cleanupNotes();
    await cleanupSmoke(studentIds);
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
