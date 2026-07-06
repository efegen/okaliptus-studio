import { Router } from "express";

import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEventsInRange,
  updateCalendarEvent,
} from "../../services/calendar-events.service.js";
import { sendError, parseId } from "../middleware/response.js";

export const calendarEventsRouter = Router();

calendarEventsRouter.get("/", async (req, res) => {
  try {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    const data = await listCalendarEventsInRange(from, to);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

calendarEventsRouter.post("/", async (req, res) => {
  try {
    const { eventType, title, startsAt, durationMinutes, labelColor, note, participantIds } =
      req.body as Record<string, unknown>;

    const data = await createCalendarEvent({
      eventType: String(eventType ?? ""),
      title: String(title ?? ""),
      startsAt: String(startsAt ?? ""),
      durationMinutes:
        durationMinutes != null ? Number(durationMinutes) : undefined,
      labelColor:
        labelColor != null ? String(labelColor) : undefined,
      note: note != null ? String(note) : null,
      // Doğrulama servis katmanında (normalizeParticipantIds) — ham geç.
      participantIds,
      actorUserId: req.currentUser.id,
    });

    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

calendarEventsRouter.patch("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const { title, durationMinutes, labelColor, note, participantIds } =
      req.body as Record<string, unknown>;

    const data = await updateCalendarEvent(id, {
      title: title != null ? String(title) : undefined,
      durationMinutes: durationMinutes != null ? Number(durationMinutes) : undefined,
      labelColor: labelColor != null ? String(labelColor) : undefined,
      note: note !== undefined ? (note != null ? String(note) : null) : undefined,
      // undefined bırakılırsa katılımcılar korunur; dizi gelirse değiştirilir.
      participantIds,
      actorUserId: req.currentUser.id,
    });

    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

calendarEventsRouter.delete("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await deleteCalendarEvent(id, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});
