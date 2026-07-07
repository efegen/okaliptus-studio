import { Router } from "express";

import {
  createUser,
  listUsers,
  setUserPassword,
  updateUser,
} from "../../services/users.service.js";
import { isRole } from "../../auth/permissions.js";
import { requireCan } from "../middleware/requireRole.js";
import { parseId, sendError } from "../middleware/response.js";

export const usersRouter = Router();

// Kullanıcı yönetimi yalnız owner ("Geliştirici") rolüne açık.
usersRouter.use(requireCan("users.manage"));

// GET /users
usersRouter.get("/", async (_req, res) => {
  try {
    const data = await listUsers();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /users
usersRouter.post("/", async (req, res) => {
  try {
    const body = req.body as {
      username?: unknown;
      displayName?: unknown;
      password?: unknown;
      role?: unknown;
    };

    if (
      typeof body.username !== "string" ||
      typeof body.displayName !== "string" ||
      typeof body.password !== "string" ||
      typeof body.role !== "string" ||
      !isRole(body.role)
    ) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "username, displayName, password ve geçerli bir rol zorunlu." },
      });
      return;
    }

    const data = await createUser(
      { username: body.username, displayName: body.displayName, password: body.password, role: body.role },
      req.currentUser.id,
    );
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /users/:id
usersRouter.patch("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body as { displayName?: unknown; role?: unknown; isActive?: unknown };

    const patch: Parameters<typeof updateUser>[1] = {};

    if (body.displayName !== undefined) {
      if (typeof body.displayName !== "string" || body.displayName.trim() === "") {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "displayName boş olamaz." } });
        return;
      }
      patch.displayName = body.displayName;
    }
    if (body.role !== undefined) {
      if (typeof body.role !== "string" || !isRole(body.role)) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Geçersiz rol." } });
        return;
      }
      patch.role = body.role;
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "isActive boolean olmalı." } });
        return;
      }
      patch.isActive = body.isActive;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Güncellenecek alan yok." } });
      return;
    }

    const data = await updateUser(id, patch, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /users/:id/password
usersRouter.post("/:id/password", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const { password } = req.body as { password?: unknown };

    if (typeof password !== "string") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "password zorunlu." } });
      return;
    }

    await setUserPassword(id, password, req.currentUser.id);
    res.json({ data: { ok: true } });
  } catch (err) {
    sendError(res, err);
  }
});
