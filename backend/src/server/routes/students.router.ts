// Ref: §3.2, §5.1
import { Router } from "express";

import {
  createStudent,
  getStudentById,
  getStudentsKpi,
  listDebtors,
  listStudents,
  listStudentMovements,
  softDeleteStudent,
  updateStudent,
} from "../../services/students.service.js";
import { ValidationError } from "../../services/errors.js";
import { sendError, parseId } from "../middleware/response.js";

export const studentsRouter = Router();

export async function listStudentMovementsHandler(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  try {
    const studentId = parseId(req.params.studentId);
    const data = await listStudentMovements(studentId);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
}

// GET /students/debtors
studentsRouter.get("/debtors", async (_req, res) => {
  try {
    const data = await listDebtors();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /students/kpi
studentsRouter.get("/kpi", async (_req, res) => {
  try {
    const data = await getStudentsKpi();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /students
studentsRouter.get("/", async (_req, res) => {
  try {
    const data = await listStudents();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /students/:id
studentsRouter.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await getStudentById(id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /students
// Fiyat artık öğrenciden gelmiyor; brüt ders fiyatı lesson_types.default_price'tan
// gelir. Gövdede defaultLessonPrice varsa ValidationError fırlatılır (sessizce
// yok sayılmaz) — backwards-compat shim eklenmez.
studentsRouter.post("/", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;

    if ("defaultLessonPrice" in body) {
      throw new ValidationError(
        "defaultLessonPrice is no longer accepted; lesson price is now sourced from lesson_types.default_price.",
      );
    }

    const {
      fullName,
      nickname,
      preferredMode,
      phone,
      email,
      birthday,
      joinedAt,
      note,
      currency,
      isActive,
    } = body;

    const data = await createStudent({
      fullName: String(fullName ?? ""),
      nickname: nickname != null ? String(nickname) : null,
      preferredMode: (preferredMode ?? null) as "online" | "onsite" | null,
      phone: phone != null ? String(phone) : null,
      email: email != null ? String(email) : null,
      birthday: birthday != null ? String(birthday) : null,
      joinedAt: joinedAt != null ? String(joinedAt) : null,
      note: note != null ? String(note) : null,
      currency: currency != null ? String(currency) : undefined,
      isActive: isActive != null ? Boolean(isActive) : undefined,
      actorUserId: req.currentUser.id,
    });
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /students/:id
studentsRouter.patch("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body as Record<string, unknown>;

    if ("defaultLessonPrice" in body) {
      throw new ValidationError(
        "defaultLessonPrice is no longer accepted; lesson price is now sourced from lesson_types.default_price.",
      );
    }

    const {
      fullName,
      nickname,
      preferredMode,
      phone,
      email,
      birthday,
      joinedAt,
      note,
      currency,
      isActive,
    } = body;

    const data = await updateStudent(id, {
      ...(fullName !== undefined && { fullName: String(fullName) }),
      ...(nickname !== undefined && {
        nickname: nickname != null ? String(nickname) : null,
      }),
      ...(preferredMode !== undefined && {
        preferredMode: (preferredMode ?? null) as "online" | "onsite" | null,
      }),
      ...(phone !== undefined && { phone: phone != null ? String(phone) : null }),
      ...(email !== undefined && { email: email != null ? String(email) : null }),
      ...(birthday !== undefined && { birthday: birthday != null ? String(birthday) : null }),
      ...(joinedAt !== undefined && { joinedAt: joinedAt != null ? String(joinedAt) : null }),
      ...(note !== undefined && { note: note != null ? String(note) : null }),
      ...(currency !== undefined && { currency: String(currency) }),
      ...(isActive !== undefined && { isActive: Boolean(isActive) }),
    }, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /students/:id
studentsRouter.delete("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await softDeleteStudent(id, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
