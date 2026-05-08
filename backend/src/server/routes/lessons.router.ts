// Ref: §5.1, §5.2, §5.10, §10 (API discipline)
import { Router } from "express";

import {
  changeLessonStatus,
  completeLesson,
  createLesson,
  getLessonById,
  listLessonsForStudent,
  listLessonsInRange,
  setLessonDiscount,
  softDeleteLesson,
  uncompleteLesson,
} from "../../services/lessons.service.js";
import type { LessonStatus } from "../../services/shared.js";
import { InvalidStatusTransitionError, ValidationError } from "../../services/errors.js";
import { sendError, parseId } from "../middleware/response.js";

export const lessonsRouter = Router();

// GET /lessons?from=<iso>&to=<iso>
// Returns lessons starting within [from, to), joined with student full_name.
lessonsRouter.get("/", async (req, res) => {
  try {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    const data = await listLessonsInRange(from, to);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /lessons
lessonsRouter.post("/", async (req, res) => {
  try {
    const { studentId, startsAt, mode, note, instructorId, lessonTypeId } =
      req.body as Record<string, unknown>;

    const data = await createLesson({
      studentId: studentId as string | number,
      startsAt: String(startsAt ?? ""),
      mode: String(mode ?? "") as "online" | "onsite",
      note: note != null ? String(note) : null,
      instructorId:
        instructorId != null && instructorId !== ""
          ? (instructorId as string | number)
          : null,
      lessonTypeId:
        lessonTypeId != null && lessonTypeId !== ""
          ? (lessonTypeId as string | number)
          : null,
      actorUserId: req.currentUser.id,
    });
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /lessons/:id
lessonsRouter.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await getLessonById(id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /lessons/:id/complete
// Spec §10: only this route triggers completeLesson() (credit allocation).
// Body alanı yok — ders tamamlama saf bir status geçişidir; ürün satışı v2
// modülünden ayrı yapılır.
lessonsRouter.post("/:id/complete", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await completeLesson(id, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /lessons/:id/uncomplete
// Tamamlanmış bir dersi 24 saat içinde geri alır. Bağlı productSale varsa siler.
lessonsRouter.post("/:id/uncomplete", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await uncompleteLesson(id, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /lessons/:id/status
// Spec §10: accepts ONLY {scheduled, cancelled, no_show}. "completed" is rejected here.
lessonsRouter.patch("/:id/status", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const { status } = req.body as Record<string, unknown>;
    const newStatus = String(status ?? "") as LessonStatus;

    const allowed: LessonStatus[] = ["scheduled", "cancelled", "no_show"];
    if (!allowed.includes(newStatus)) {
      // "completed" via this route is a business rule violation, not a format error → 409
      throw new InvalidStatusTransitionError(
        `PATCH /lessons/:id/status only accepts: ${allowed.join(", ")}. Use POST /lessons/:id/complete to complete a lesson.`,
      );
    }

    const data = await changeLessonStatus(id, newStatus, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /lessons/:id/discount
// Karar 4: ders indiriminin idempotent set edildiği endpoint. Body
// { discountAmount, note? }. 0 indirimi kaldırır. Sadece completed &
// non-prepaid derslere uygulanabilir (karar 5); paid_amount net tutarı
// aşıyorsa 409 döner (karar 6).
lessonsRouter.patch("/:id/discount", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const { discountAmount, note } = req.body as Record<string, unknown>;

    if (discountAmount === undefined || discountAmount === null) {
      throw new ValidationError("discountAmount is required.");
    }

    const data = await setLessonDiscount({
      lessonId: id,
      discountAmount: discountAmount as number | string,
      note: note != null ? String(note) : null,
      actorUserId: req.currentUser.id,
    });
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /lessons/:id
// Soft-deletes a lesson (used for "user error" cancellations where the lesson should
// vanish entirely — no calendar trace, no student-profile record). Refuses if the
// lesson already has payments attached.
lessonsRouter.delete("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await softDeleteLesson(id, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /students/:studentId/lessons — registered in students router, but handler lives here
export async function listStudentLessonsHandler(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  try {
    const studentId = parseId(req.params.studentId);
    const data = await listLessonsForStudent(studentId);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
}
