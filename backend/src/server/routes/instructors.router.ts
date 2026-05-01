import { Router } from "express";

import {
  listActiveInstructors,
  listAllInstructors,
  createInstructor,
  updateInstructor,
  deleteInstructor,
} from "../../services/instructors.service.js";
import { sendError } from "../middleware/response.js";

export const instructorsRouter = Router();

// GET /instructors           → aktif eğitmenler (modal/dropdown'lar için)
// GET /instructors?include=all → silinmemiş tüm eğitmenler (yönetim sayfası için)
instructorsRouter.get("/", async (req, res) => {
  try {
    const data =
      req.query.include === "all"
        ? await listAllInstructors()
        : await listActiveInstructors();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /instructors
instructorsRouter.post("/", async (req, res) => {
  try {
    const { full_name } = req.body as { full_name?: unknown };

    if (typeof full_name !== "string" || full_name.trim() === "") {
      res.status(400).json({ error: { message: "full_name zorunlu." } });
      return;
    }

    const data = await createInstructor(
      { full_name: full_name.trim() },
      req.currentUser.id,
    );
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /instructors/:id
instructorsRouter.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body as { full_name?: unknown; is_active?: unknown };

    const patch: Parameters<typeof updateInstructor>[1] = {};

    if (body.full_name !== undefined) {
      if (typeof body.full_name !== "string" || body.full_name.trim() === "") {
        res.status(400).json({ error: { message: "full_name boş olamaz." } });
        return;
      }
      patch.full_name = body.full_name.trim();
    }
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") {
        res.status(400).json({ error: { message: "is_active boolean olmalı." } });
        return;
      }
      patch.is_active = body.is_active;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: { message: "Güncellenecek alan yok." } });
      return;
    }

    const data = await updateInstructor(id, patch, req.currentUser.id);
    if (!data) {
      res.status(404).json({ error: { message: "Eğitmen bulunamadı." } });
      return;
    }
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /instructors/:id (soft delete)
instructorsRouter.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const removed = await deleteInstructor(id, req.currentUser.id);
    if (!removed) {
      res.status(404).json({ error: { message: "Eğitmen bulunamadı." } });
      return;
    }
    res.json({ data: { id: removed.id } });
  } catch (err) {
    sendError(res, err);
  }
});
