import { Router } from "express";

import { listActiveInstructors } from "../../services/instructors.service.js";
import { sendError } from "../middleware/response.js";

export const instructorsRouter = Router();

// GET /instructors
// Returns active instructors (for UI selection in lesson creation modal).
instructorsRouter.get("/", async (_req, res) => {
  try {
    const data = await listActiveInstructors();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
