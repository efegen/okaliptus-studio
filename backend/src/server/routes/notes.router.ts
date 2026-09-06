import express, { Router } from "express";

import {
  addNote,
  createNoteCategory,
  deleteNoteCategory,
  deleteNote,
  getNoteImage,
  listNoteCategories,
  listNoteReminderRecipients,
  listNotes,
  setNoteImage,
  toggleNoteReaction,
  updateNoteCategory,
  updateNote,
} from "../../services/notes.service.js";
import { ValidationError } from "../../services/errors.js";
import { sendError, parseId } from "../middleware/response.js";

// Stüdyo geneli "Notlar" akışı — 0273'e kadar /events/:id/notes altındaydı,
// etkinlikten koparılınca kendi router'ına taşındı (bkz. notes.service.ts).
// Herkese açık paylaşım akışı: kim eklediyse herkes görür (rol bazlı kısıtlama
// yok, requireAuth yeterli). Düzenleme/silme yalnız notun kendi yazarına açık.
export const notesRouter = Router();

notesRouter.get("/", async (_req, res) => {
  try {
    const data = await listNotes(_req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

notesRouter.get("/categories", async (_req, res) => {
  try {
    res.json({ data: await listNoteCategories() });
  } catch (err) {
    sendError(res, err);
  }
});

notesRouter.post("/categories", async (req, res) => {
  try {
    const { name } = req.body as Record<string, unknown>;
    const data = await createNoteCategory(String(name ?? ""), req.currentUser.id);
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

notesRouter.patch("/categories/:categoryId", async (req, res) => {
  try {
    const categoryId = parseId(req.params.categoryId);
    const { name } = req.body as Record<string, unknown>;
    res.json({ data: await updateNoteCategory(categoryId, String(name ?? "")) });
  } catch (err) {
    sendError(res, err);
  }
});

notesRouter.delete("/categories/:categoryId", async (req, res) => {
  try {
    const categoryId = parseId(req.params.categoryId);
    await deleteNoteCategory(categoryId);
    res.json({ data: null });
  } catch (err) {
    sendError(res, err);
  }
});

// Hatırlatıcı "kime?" seçicisi — tüm roller erişebilir (bkz. notes.service.ts
// listNoteReminderRecipients üstteki not). :noteId param'lı rotalardan önce
// tanımlı olmasına gerek yok (tek segment, çakışan bir GET /:noteId yok) ama
// okunurluk için diğer liste uçlarının yanında durur.
notesRouter.get("/reminder-recipients", async (_req, res) => {
  try {
    res.json({ data: await listNoteReminderRecipients() });
  } catch (err) {
    sendError(res, err);
  }
});

notesRouter.get("/:noteId/image", async (req, res) => {
  try {
    const noteId = parseId(req.params.noteId);
    const image = await getNoteImage(noteId);
    if (!image) {
      res.status(404).json({ error: { code: "NOTE_IMAGE_NOT_FOUND", message: "Not fotoğrafı yok." } });
      return;
    }
    const etag = `"${new Date(image.updatedAt).getTime()}"`;
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.setHeader("Content-Type", image.mime);
    res.setHeader("Content-Length", image.bytes.length);
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.end(image.bytes);
  } catch (err) {
    sendError(res, err);
  }
});

function parseMentionedStudentIds(raw: unknown): (string | number)[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((id) => id != null && id !== "") as (string | number)[];
}

function parseCategoryId(raw: unknown): string | number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new ValidationError("Kategori bilgisi geçersiz.");
  }
  parseId(String(raw));
  return raw;
}

function parseReminderInput(raw: unknown): { remindAt: string; recipientUserIds: (string | number)[] } | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("Hatırlatıcı bilgileri geçersiz.");
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.remindAt !== "string" || !Array.isArray(r.recipientUserIds)) {
    throw new ValidationError("Hatırlatıcı bilgileri geçersiz.");
  }
  if (r.recipientUserIds.some((id) => (
    (typeof id !== "string" && typeof id !== "number") || String(id).trim() === ""
  ))) {
    throw new ValidationError("Hatırlatıcı alıcıları geçersiz.");
  }
  return {
    remindAt: r.remindAt,
    recipientUserIds: r.recipientUserIds as (string | number)[],
  };
}

notesRouter.post("/", async (req, res) => {
  try {
    const { body, parentNoteId, mentionedStudentIds, categoryId, reminder } = req.body as Record<string, unknown>;
    const data = await addNote({
      body: String(body ?? ""),
      parentNoteId: parentNoteId != null && parentNoteId !== "" ? (parentNoteId as string | number) : null,
      mentionedStudentIds: parseMentionedStudentIds(mentionedStudentIds),
      categoryId: parseCategoryId(categoryId),
      reminder: parseReminderInput(reminder),
      actorUserId: req.currentUser.id,
    });
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

notesRouter.patch("/:noteId", async (req, res) => {
  try {
    const noteId = parseId(req.params.noteId);
    const payload = req.body as Record<string, unknown>;
    const { body, mentionedStudentIds, categoryId } = payload;
    const data = await updateNote(noteId, {
      body: String(body ?? ""),
      mentionedStudentIds: parseMentionedStudentIds(mentionedStudentIds),
      categoryId: Object.prototype.hasOwnProperty.call(payload, "categoryId")
        ? (parseCategoryId(categoryId) ?? null)
        : undefined,
      actorUserId: req.currentUser.id,
    });
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

notesRouter.post("/:noteId/reactions", async (req, res) => {
  try {
    const noteId = parseId(req.params.noteId);
    const { emoji } = req.body as Record<string, unknown>;
    const data = await toggleNoteReaction(noteId, String(emoji ?? ""), req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

notesRouter.post(
  "/:noteId/image",
  express.raw({ type: ["image/webp", "image/jpeg", "image/png"], limit: "5mb" }),
  async (req, res) => {
    try {
      const noteId = parseId(req.params.noteId);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Görsel verisi okunamadı. İçerik tipi image/webp, image/jpeg veya image/png olmalı.",
          },
        });
        return;
      }
      const mime = (req.get("content-type") || "").split(";")[0].trim();
      const data = await setNoteImage(noteId, mime, req.body, req.currentUser.id);
      res.json({ data });
    } catch (err) {
      sendError(res, err);
    }
  },
);

notesRouter.delete("/:noteId", async (req, res) => {
  try {
    const noteId = parseId(req.params.noteId);
    await deleteNote(noteId, req.currentUser.id);
    res.json({ data: null });
  } catch (err) {
    sendError(res, err);
  }
});
