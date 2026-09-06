// Notlar — stüdyo genelinde TEK bir paylaşılan not akışı (bkz.
// 0268_event_notes.sql → 0270_event_note_updates.sql → 0273_general_notes.sql
// → 0275_note_reactions_and_images.sql).
//
// Modül önce etkinlik detayının bir alt ekranı olarak doğdu (etkinlik başına
// ayrı not listesi), 0273'te kullanıcı isteğiyle etkinlikten koparıldı: mobil
// ana sayfadaki "Notlar" butonu da etkinlik detayındaki "Notlar" kısayolu da
// aynı listeyi açar. events.note (Etkinlik ayarları'ndaki tekil alan) ile
// karıştırılmamalı — o hâlâ etkinliğe özel, tek satırlık bir alandır.
//
// Herkes her notu görür (rol kısıtı yok, requireAuth yeterli); düzenleme/silme
// yalnız notun kendi yazarına açıktır (bkz. lockOwnedNote). Silme soft-delete:
// bir yanıt zinciri varken üst not satırı yok edilmez.

import type { PoolClient } from "pg";

import { pool } from "../db/connection.js";
import {
  NoteForbiddenError,
  NoteCategoryNotFoundError,
  NoteNotFoundError,
  StudentNotFoundError,
  ValidationError,
  toServiceError,
} from "./errors.js";
import {
  insertAuditLog,
  normalizeRequiredText,
  rollbackQuietly,
  type EntityId,
} from "./shared.js";

type Queryable = Pick<PoolClient, "query">;

export type NoteMention = {
  studentId: string;
  name: string;
};

export type NoteReaction = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

export type NoteCategoryRow = {
  id: string;
  name: string;
  note_count: number;
  created_at: string;
  updated_at: string;
};

export type NoteCategoryRef = {
  id: string;
  name: string;
};

// Silinen notlarda body null döner (deleted_at doludur) — istemci satırı
// listeden düşürür ama yanıtları göstermeye devam eder.
export type NoteRow = {
  id: string;
  author_user_id: string;
  author_name: string;
  author_role: string;
  body: string | null;
  parent_note_id: string | null;
  category: NoteCategoryRef | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  mentions: NoteMention[];
  reactions: NoteReaction[];
  has_image: boolean;
  image_updated_at: string | null;
};

// author_name ve bahsedilen öğrenci adları sorgu anında JOIN edilir, satıra
// kopyalanmaz — görünen ad sonradan değişirse geçmiş notlarda da güncel görünür.
// Tepkiler de tek sorguda gruplanır; actorPlaceholder listeyi isteyen/güncelleyen
// kullanıcının kendi tepkisini `reactedByMe` olarak işaretlemeyi sağlar.
function noteSelect(actorPlaceholder: string): string {
  return `
  SELECT n.id, n.author_user_id, u.display_name AS author_name, u.role AS author_role,
         CASE WHEN n.deleted_at IS NULL THEN n.body ELSE NULL END AS body,
         n.parent_note_id,
         CASE
           WHEN n.parent_note_id IS NULL AND c.id IS NOT NULL
             THEN json_build_object('id', c.id::text, 'name', c.name)
           ELSE NULL
         END AS category,
         n.created_at, n.updated_at, n.deleted_at,
         COALESCE(mentions.list, '[]'::json) AS mentions,
         COALESCE(reactions.list, '[]'::json) AS reactions,
         (ni.note_id IS NOT NULL) AS has_image,
         ni.updated_at AS image_updated_at
    FROM notes n
    JOIN users u ON u.id = n.author_user_id
    LEFT JOIN note_images ni ON ni.note_id = n.id
    LEFT JOIN note_categories c ON c.id = n.category_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('studentId', m.student_id::text, 'name', COALESCE(s.nickname, s.full_name)) ORDER BY m.student_id) AS list
        FROM note_mentions m
        JOIN students s ON s.id = m.student_id
       WHERE m.note_id = n.id
    ) mentions ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(
               json_build_object(
                 'emoji', grouped.emoji,
                 'count', grouped.reaction_count,
                 'reactedByMe', grouped.reacted_by_me
               )
               ORDER BY grouped.first_reacted_at, grouped.emoji
             ) AS list
        FROM (
          SELECT r.emoji,
                 count(*)::int AS reaction_count,
                 bool_or(r.user_id = ${actorPlaceholder}::bigint) AS reacted_by_me,
                 min(r.created_at) AS first_reacted_at
            FROM note_reactions r
           WHERE r.note_id = n.id
           GROUP BY r.emoji
        ) grouped
    ) reactions ON true
`;
}

async function fetchNoteById(
  client: Queryable,
  noteId: EntityId,
  actorUserId: number | string,
): Promise<NoteRow> {
  const result = await client.query<NoteRow>(`${noteSelect("$2")} WHERE n.id = $1`, [noteId, actorUserId]);
  return result.rows[0];
}

// Not silinmişse (deleted_at) ya da hiç yoksa "bulunamadı" — düzenleme/silme
// isteği zaten silinmiş bir notu ikinci kez hedefleyemez.
async function lockOwnedNote(
  client: PoolClient,
  noteId: EntityId,
  actorUserId: number | string,
): Promise<{ id: string; parent_note_id: string | null }> {
  const result = await client.query<{ id: string; author_user_id: string; parent_note_id: string | null; deleted_at: string | null }>(
    `SELECT id, author_user_id, parent_note_id, deleted_at FROM notes WHERE id = $1 FOR UPDATE`,
    [noteId],
  );
  const note = result.rows[0];
  if (!note || note.deleted_at) throw new NoteNotFoundError();
  if (String(note.author_user_id) !== String(actorUserId)) throw new NoteForbiddenError();
  return note;
}

function normalizeCategoryName(value: string): string {
  const name = normalizeRequiredText(value, "name");
  if (name.length > 40) throw new ValidationError("Kategori adı en fazla 40 karakter olabilir.");
  return name;
}

// null/undefined → not kategorisiz kalır (kategori seçimi zorunlu değil).
async function resolveCategoryId(
  client: Queryable,
  categoryId: EntityId | null | undefined,
): Promise<string | null> {
  if (categoryId == null) return null;
  const result = await client.query<{ id: string }>(
    `SELECT id FROM note_categories WHERE id = $1`,
    [categoryId],
  );
  if (!result.rows[0]) throw new NoteCategoryNotFoundError();
  return result.rows[0].id;
}

export async function listNoteCategories(): Promise<NoteCategoryRow[]> {
  const result = await pool.query<NoteCategoryRow>(
    `SELECT c.id, c.name,
            (SELECT count(*)::int
               FROM notes n
              WHERE n.category_id = c.id AND n.deleted_at IS NULL) AS note_count,
            c.created_at, c.updated_at
       FROM note_categories c
      ORDER BY lower(c.name), c.id`,
  );
  return result.rows;
}

export async function createNoteCategory(
  nameValue: string,
  actorUserId: number | string,
): Promise<NoteCategoryRow> {
  const name = normalizeCategoryName(nameValue);
  try {
    const result = await pool.query<NoteCategoryRow>(
      `INSERT INTO note_categories (name, created_by_user_id)
       VALUES ($1, $2)
       RETURNING id, name, 0::int AS note_count, created_at, updated_at`,
      [name, actorUserId],
    );
    return result.rows[0];
  } catch (error) {
    throw toServiceError(error);
  }
}

export async function updateNoteCategory(categoryId: EntityId, nameValue: string): Promise<NoteCategoryRow> {
  const name = normalizeCategoryName(nameValue);
  try {
    const result = await pool.query<NoteCategoryRow>(
      `UPDATE note_categories c
          SET name = $1
        WHERE c.id = $2
        RETURNING c.id, c.name,
          (SELECT count(*)::int
             FROM notes n
            WHERE n.category_id = c.id AND n.deleted_at IS NULL) AS note_count,
          c.created_at, c.updated_at`,
      [name, categoryId],
    );
    if (!result.rows[0]) throw new NoteCategoryNotFoundError();
    return result.rows[0];
  } catch (error) {
    if (error instanceof NoteCategoryNotFoundError) throw error;
    throw toServiceError(error);
  }
}

export async function deleteNoteCategory(categoryId: EntityId): Promise<void> {
  const result = await pool.query<{ id: string }>(
    `DELETE FROM note_categories WHERE id = $1 RETURNING id`,
    [categoryId],
  );
  if (!result.rows[0]) throw new NoteCategoryNotFoundError();
}

// "@" bahisleri her düzenlemede tamamen değiştirilir (silinip yeniden eklenir) —
// kısmi diff uğraşmaya değmeyecek kadar küçük bir liste. Öğrenci var mı diye
// kontrol edilir ki istemci tarafındaki öğrenci önbelleği bayatlamışsa FK
// hatası yerine anlaşılır bir ValidationError dönsün.
async function replaceNoteMentions(
  client: PoolClient,
  noteId: EntityId,
  studentIds: EntityId[],
): Promise<void> {
  await client.query(`DELETE FROM note_mentions WHERE note_id = $1`, [noteId]);

  const uniqueIds = [...new Set(studentIds.map((id) => String(id)))];
  if (uniqueIds.length === 0) return;

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM students WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
    [uniqueIds],
  );
  if (existing.rows.length !== uniqueIds.length) {
    throw new StudentNotFoundError("Bahsedilen öğrencilerden biri bulunamadı.");
  }

  const values = uniqueIds.map((_, i) => `($1, $${i + 2})`).join(", ");
  await client.query(
    `INSERT INTO note_mentions (note_id, student_id) VALUES ${values}`,
    [noteId, ...uniqueIds],
  );
}

// Yalnız aktif kullanıcılar alıcı olabilir; zaman gelecekte olmalı. Doğrulama
// başarısızsa not eklenmez (aynı transaction) — yarım bir "not var ama
// hatırlatıcı yok" durumu oluşmaz.
async function insertNoteReminder(
  client: PoolClient,
  noteId: EntityId,
  actorUserId: number | string,
  reminder: { remindAt: string; recipientUserIds: EntityId[] },
): Promise<string> {
  const remindAt = new Date(reminder.remindAt);
  if (Number.isNaN(remindAt.getTime()) || remindAt.getTime() <= Date.now()) {
    throw new ValidationError("Hatırlatma zamanı gelecekte olmalı.");
  }

  const recipientIds = [...new Set((reminder.recipientUserIds ?? []).map((id) => String(id)))];
  if (recipientIds.length === 0) {
    throw new ValidationError("Hatırlatma için en az bir kişi seçilmeli.");
  }

  const activeUsers = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE id = ANY($1::bigint[]) AND is_active = true`,
    [recipientIds],
  );
  if (activeUsers.rows.length !== recipientIds.length) {
    throw new ValidationError("Hatırlatma alıcılarından biri bulunamadı ya da pasif.");
  }

  await client.query(
    `INSERT INTO note_reminders (note_id, created_by_user_id, remind_at, recipient_user_ids)
     VALUES ($1, $2, $3, $4::bigint[])`,
    [noteId, actorUserId, remindAt.toISOString(), recipientIds],
  );
  return remindAt.toISOString();
}

export async function listNotes(actorUserId: number | string): Promise<NoteRow[]> {
  const result = await pool.query<NoteRow>(
    `${noteSelect("$1")}
      ORDER BY n.created_at DESC, n.id DESC`,
    [actorUserId],
  );
  return result.rows;
}

export type NoteReminderRecipientRow = {
  id: string;
  displayName: string;
  role: string;
};

// Hatırlatıcı "kime?" seçicisi için — /users'ın aksine (yalnız owner)
// tüm oturum açmış roller erişebilir; not yazarları zaten herkese görünür
// olduğundan (author_name/author_role) burada ek bir gizlilik sorunu yok.
export async function listNoteReminderRecipients(): Promise<NoteReminderRecipientRow[]> {
  const result = await pool.query<NoteReminderRecipientRow>(
    `SELECT id, display_name AS "displayName", role
       FROM users
      WHERE is_active = true
      ORDER BY display_name`,
  );
  return result.rows;
}

export async function addNote(input: {
  body: string;
  actorUserId: number | string;
  parentNoteId?: EntityId | null;
  mentionedStudentIds?: EntityId[];
  categoryId?: EntityId | null;
  reminder?: { remindAt: string; recipientUserIds: EntityId[] } | null;
}): Promise<NoteRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const body = normalizeRequiredText(input.body, "body");

    // Yanıt tek seviye: yanıtın kendisi bir yanıta yanıt olamaz (bkz.
    // 0270_event_note_updates.sql üstteki not).
    let parentNoteId: string | null = null;
    if (input.parentNoteId != null) {
      const parentResult = await client.query<{ id: string; parent_note_id: string | null }>(
        `SELECT id, parent_note_id FROM notes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [input.parentNoteId],
      );
      const parent = parentResult.rows[0];
      if (!parent) throw new NoteNotFoundError();
      if (parent.parent_note_id != null) {
        throw new ValidationError("Bir yanıta yanıt verilemez.");
      }
      parentNoteId = parent.id;
    }

    if (parentNoteId && input.categoryId != null) {
      throw new ValidationError("Yanıtlara kategori atanamaz.");
    }
    const categoryId = parentNoteId ? null : await resolveCategoryId(client, input.categoryId);

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO notes (author_user_id, body, parent_note_id, category_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [input.actorUserId, body, parentNoteId, categoryId],
    );
    const noteId = insertResult.rows[0].id;

    await replaceNoteMentions(client, noteId, input.mentionedStudentIds ?? []);

    let reminderAt: string | null = null;
    if (input.reminder) {
      reminderAt = await insertNoteReminder(client, noteId, input.actorUserId, input.reminder);
    }

    await insertAuditLog(client, {
      action: "note_created",
      entityType: "note",
      entityId: noteId,
      after: { body, parentNoteId, categoryId, ...(reminderAt ? { reminderAt } : {}) },
      actorUserId: input.actorUserId,
    });

    await client.query("COMMIT");

    return await fetchNoteById(client, noteId, input.actorUserId);
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function updateNote(
  noteId: EntityId,
  input: {
    body: string;
    actorUserId: number | string;
    mentionedStudentIds?: EntityId[];
    categoryId?: EntityId | null;
  },
): Promise<NoteRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const ownedNote = await lockOwnedNote(client, noteId, input.actorUserId);

    const body = normalizeRequiredText(input.body, "body");

    let categoryId: string | null | undefined;
    if (input.categoryId !== undefined) {
      if (ownedNote.parent_note_id && input.categoryId != null) {
        throw new ValidationError("Yanıtlara kategori atanamaz.");
      }
      categoryId = ownedNote.parent_note_id ? null : await resolveCategoryId(client, input.categoryId);
      await client.query(`UPDATE notes SET body = $1, category_id = $2 WHERE id = $3`, [body, categoryId, noteId]);
    } else {
      await client.query(`UPDATE notes SET body = $1 WHERE id = $2`, [body, noteId]);
    }
    await replaceNoteMentions(client, noteId, input.mentionedStudentIds ?? []);

    await insertAuditLog(client, {
      action: "note_updated",
      entityType: "note",
      entityId: noteId,
      after: { body, ...(categoryId !== undefined ? { categoryId } : {}) },
      actorUserId: input.actorUserId,
    });

    await client.query("COMMIT");

    return await fetchNoteById(client, noteId, input.actorUserId);
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export const ALLOWED_NOTE_REACTIONS = ["👍", "❤️", "🙌", "😂", "😮", "😢"] as const;

export async function toggleNoteReaction(
  noteId: EntityId,
  emoji: string,
  actorUserId: number | string,
): Promise<NoteRow> {
  if (!ALLOWED_NOTE_REACTIONS.includes(emoji as (typeof ALLOWED_NOTE_REACTIONS)[number])) {
    throw new ValidationError("Desteklenmeyen emoji tepkisi.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Aynı nota eşzamanlı çift dokunuşları sıraya koy; toggle sonucu kararlı
    // kalsın. Silinmiş nota tepki bırakılamaz.
    const noteResult = await client.query<{ id: string }>(
      `SELECT id FROM notes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [noteId],
    );
    if (!noteResult.rows[0]) throw new NoteNotFoundError();

    const deleted = await client.query(
      `DELETE FROM note_reactions
        WHERE note_id = $1 AND user_id = $2 AND emoji = $3
        RETURNING note_id`,
      [noteId, actorUserId, emoji],
    );
    if (deleted.rowCount === 0) {
      await client.query(
        `INSERT INTO note_reactions (note_id, user_id, emoji) VALUES ($1, $2, $3)`,
        [noteId, actorUserId, emoji],
      );
    }

    await client.query("COMMIT");
    return await fetchNoteById(client, noteId, actorUserId);
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

const ALLOWED_IMAGE_MIME = new Set(["image/webp", "image/jpeg", "image/png"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function matchesImageSignature(mime: string, bytes: Buffer): boolean {
  switch (mime) {
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
      );
    case "image/webp":
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
      );
    default:
      return false;
  }
}

export type NoteImageData = {
  mime: string;
  bytes: Buffer;
  updatedAt: string;
};

export async function getNoteImage(noteId: EntityId): Promise<NoteImageData | null> {
  const result = await pool.query<{
    mime: string;
    bytes: Buffer;
    updated_at: string;
  }>(
    `SELECT ni.mime, ni.bytes, ni.updated_at
       FROM note_images ni
       JOIN notes n ON n.id = ni.note_id
      WHERE ni.note_id = $1 AND n.deleted_at IS NULL`,
    [noteId],
  );
  const row = result.rows[0];
  return row ? { mime: row.mime, bytes: row.bytes, updatedAt: row.updated_at } : null;
}

export async function setNoteImage(
  noteId: EntityId,
  mime: string,
  bytes: Buffer,
  actorUserId: number | string,
): Promise<NoteRow> {
  if (!ALLOWED_IMAGE_MIME.has(mime)) {
    throw new ValidationError("Desteklenmeyen görsel türü. Yalnız WebP, JPEG veya PNG.");
  }
  if (!bytes || bytes.length === 0) throw new ValidationError("Görsel verisi boş.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new ValidationError("Görsel 5MB sınırını aşıyor.");
  if (!matchesImageSignature(mime, bytes)) {
    throw new ValidationError("Görsel içeriği belirtilen türle uyuşmuyor.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockOwnedNote(client, noteId, actorUserId);

    await client.query(
      `INSERT INTO note_images (note_id, mime, bytes, byte_size, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (note_id) DO UPDATE
         SET mime = EXCLUDED.mime,
             bytes = EXCLUDED.bytes,
             byte_size = EXCLUDED.byte_size,
             updated_at = now()`,
      [noteId, mime, bytes, bytes.length],
    );

    await insertAuditLog(client, {
      action: "note_updated",
      entityType: "note",
      entityId: noteId,
      after: { hasImage: true },
      note: "fotoğraf yüklendi",
      actorUserId,
    });

    await client.query("COMMIT");
    return await fetchNoteById(client, noteId, actorUserId);
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function deleteNote(noteId: EntityId, actorUserId: number | string): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await lockOwnedNote(client, noteId, actorUserId);

    await client.query(`UPDATE notes SET deleted_at = now() WHERE id = $1`, [noteId]);

    await insertAuditLog(client, {
      action: "note_deleted",
      entityType: "note",
      entityId: noteId,
      actorUserId,
    });

    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}
