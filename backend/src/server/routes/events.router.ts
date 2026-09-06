import { Router } from "express";

import { verifyUserPassword } from "../../services/auth.service.js";
import { ReauthenticationFailedError } from "../../services/errors.js";

import {
  addExistingParticipant,
  addFeeItem,
  addNewParticipant,
  assignParticipantToVehicle,
  cancelParticipantPayment,
  createEvent,
  createVehicle,
  deleteVehicle,
  deleteEvent,
  getEventById,
  getUpcomingEvent,
  listEventBalancesForStudent,
  listEvents,
  listParticipantFees,
  listParticipantPayments,
  listParticipants,
  listVehicles,
  recordParticipantPayment,
  removeParticipant,
  searchStudentsForEvent,
  updateEvent,
  updateParticipant,
  updateParticipantFee,
  updateVehicle,
} from "../../services/events.service.js";
import { sendError, parseId } from "../middleware/response.js";
import { requireCan } from "../middleware/requireRole.js";

export const eventsRouter = Router();

eventsRouter.post("/", async (req, res) => {
  try {
    const { name, startsAt, location, capacityLimit, transportEnabled, note, feeItems } =
      req.body as Record<string, unknown>;
    const data = await createEvent({
      name: String(name ?? ""),
      startsAt: String(startsAt ?? ""),
      location: location != null ? String(location) : null,
      capacityLimit: capacityLimit != null ? Number(capacityLimit) : null,
      transportEnabled: Boolean(transportEnabled),
      note: note != null ? String(note) : null,
      feeItems: Array.isArray(feeItems)
        ? feeItems.map((raw) => {
            const item = raw as Record<string, unknown>;
            return {
              label: String(item.label ?? ""),
              amount: item.amount as string | number,
              compQuota:
                item.compQuota != null && item.compQuota !== "" ? Number(item.compQuota) : null,
              isPassThrough: Boolean(item.isPassThrough),
              isLessonFee: Boolean(item.isLessonFee),
            };
          })
        : undefined,
      actorUserId: req.currentUser.id,
    });
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.get("/", async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const data = await listEvents({ status: status as never });
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// Ana sayfa kartı (4d): en yakın upcoming/live etkinlik, yoksa null.
eventsRouter.get("/upcoming", async (_req, res) => {
  try {
    const data = await getUpcomingEvent();
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await getEventById(id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.patch("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const { name, startsAt, location, status, capacityLimit, transportEnabled, note } =
      req.body as Record<string, unknown>;
    const data = await updateEvent(
      id,
      {
        ...(name !== undefined && { name: String(name) }),
        ...(startsAt !== undefined && { startsAt: String(startsAt) }),
        ...(location !== undefined && { location: location != null ? String(location) : null }),
        ...(status !== undefined && { status: status as never }),
        ...(capacityLimit !== undefined && {
          capacityLimit: capacityLimit != null ? Number(capacityLimit) : null,
        }),
        ...(transportEnabled !== undefined && { transportEnabled: Boolean(transportEnabled) }),
        ...(note !== undefined && { note: note != null ? String(note) : null }),
      },
      req.currentUser.id,
    );
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// Etkinlik ayarları → "Etkinliği sil". Ödemesi olan etkinlik reddedilir
// (EVENT_HAS_PAYMENTS) — bkz. events.service.ts deleteEvent.
eventsRouter.delete("/:id", requireCan("events.delete"), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const { password } = req.body as Record<string, unknown>;
    if (!await verifyUserPassword(req.currentUser.id, password)) {
      throw new ReauthenticationFailedError();
    }
    await deleteEvent(id, req.currentUser.id);
    res.json({ data: null });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.post("/:id/fee-items", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const { label, amount, compQuota, isPassThrough } = req.body as Record<string, unknown>;
    const data = await addFeeItem(
      id,
      {
        label: String(label ?? ""),
        amount: amount as string | number,
        compQuota: compQuota != null && compQuota !== "" ? Number(compQuota) : null,
        isPassThrough: Boolean(isPassThrough),
      },
      req.currentUser.id,
    );
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.get("/:id/participants", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await listParticipants(id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// 6a: kayıtlı öğrenciler içinde arar, bu etkinlikte zaten var mı işaretler.
eventsRouter.get("/:id/participants/search", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const data = await searchStudentsForEvent(id, q);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// 6b (studentId verilir) veya 6c (fullName verilir — yeni kişi oluşturulup
// aynı anda eklenir) — aynı endpoint, gövde şekline göre dallanır.
eventsRouter.post("/:id/participants", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body as Record<string, unknown>;
    const common = {
      role: body.role as never,
      rsvpStatus: body.rsvpStatus as never,
      guestOfParticipantId:
        body.guestOfParticipantId != null && body.guestOfParticipantId !== ""
          ? (body.guestOfParticipantId as string | number)
          : null,
      transportMode: body.transportMode as never,
      // Kalem bazlı "kim ödüyor" override'ları; boşsa rol ön ayarı uygulanır.
      fees: Array.isArray(body.fees)
        ? body.fees.map((raw) => {
            const fee = raw as Record<string, unknown>;
            return {
              feeItemId: fee.feeItemId as string | number,
              coverage: fee.coverage as never,
            };
          })
        : undefined,
      actorUserId: req.currentUser.id,
    };

    const data =
      body.studentId != null
        ? await addExistingParticipant(id, { studentId: body.studentId as string | number, ...common })
        : await addNewParticipant(id, {
            fullName: String(body.fullName ?? ""),
            phone: body.phone != null ? String(body.phone) : null,
            ...common,
          });
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.patch("/participants/:participantId", async (req, res) => {
  try {
    const participantId = parseId(req.params.participantId);
    const { role, rsvpStatus, transportMode, attendanceStatus, note } =
      req.body as Record<string, unknown>;
    const data = await updateParticipant(
      participantId,
      {
        ...(role !== undefined && { role: role as never }),
        ...(rsvpStatus !== undefined && { rsvpStatus: rsvpStatus as never }),
        ...(transportMode !== undefined && { transportMode: transportMode as never }),
        ...(attendanceStatus !== undefined && { attendanceStatus: attendanceStatus as never }),
        ...(note !== undefined && { note: note != null ? String(note) : null }),
      },
      req.currentUser.id,
    );
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

// RSVP'de "gelmiyor" yok — gelmeyecek kişi doğrudan listeden silinir.
eventsRouter.delete("/participants/:participantId", async (req, res) => {
  try {
    const participantId = parseId(req.params.participantId);
    await removeParticipant(participantId, req.currentUser.id);
    res.json({ data: null });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.get("/participants/:participantId/fees", async (req, res) => {
  try {
    const participantId = parseId(req.params.participantId);
    const data = await listParticipantFees(participantId);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.patch("/participants/:participantId/fees/:feeItemId", async (req, res) => {
  try {
    const participantId = parseId(req.params.participantId);
    const feeItemId = parseId(req.params.feeItemId);
    const { coverage, included, amount } = req.body as Record<string, unknown>;
    await updateParticipantFee(
      participantId,
      feeItemId,
      {
        ...(coverage !== undefined ? { coverage: coverage as never } : {}),
        ...(included !== undefined ? { included: Boolean(included) } : {}),
        ...(amount !== undefined ? { amount: amount as string | number } : {}),
      },
      req.currentUser.id,
    );
    res.json({ data: null });
  } catch (err) {
    sendError(res, err);
  }
});

// Tek tutar; katılımcının ödenmemiş dahil kalemlerine sırayla dağıtılır.
eventsRouter.post("/participants/:participantId/payments", async (req, res) => {
  try {
    const participantId = parseId(req.params.participantId);
    const { amount, source, idempotencyKey } = req.body as Record<string, unknown>;
    const data = await recordParticipantPayment(
      participantId,
      amount as string | number,
      req.currentUser.id,
      source as "cash" | "iban",
      idempotencyKey == null || idempotencyKey === "" ? undefined : String(idempotencyKey),
    );
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.get("/participants/:participantId/payments", async (req, res) => {
  try {
    const participantId = parseId(req.params.participantId);
    const data = await listParticipantPayments(participantId);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.delete("/payments/:paymentId", async (req, res) => {
  try {
    const paymentId = parseId(req.params.paymentId);
    const { note } = req.body as Record<string, unknown>;
    const data = await cancelParticipantPayment(
      paymentId,
      note != null ? String(note) : null,
      req.currentUser.id,
    );
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.get("/:id/vehicles", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const data = await listVehicles(id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.post("/:id/vehicles", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const { vehicleType, driverStudentId, driverName, driverPhone, passengerSeats, meetingTime, meetingPlace, note } =
      req.body as Record<string, unknown>;
    const data = await createVehicle(id, {
      vehicleType: vehicleType as never,
      driverStudentId: driverStudentId != null && driverStudentId !== "" ? (driverStudentId as string | number) : null,
      driverName: driverName != null ? String(driverName) : null,
      driverPhone: driverPhone != null ? String(driverPhone) : null,
      passengerSeats: Number(passengerSeats),
      meetingTime: meetingTime != null ? String(meetingTime) : null,
      meetingPlace: meetingPlace != null ? String(meetingPlace) : null,
      note: note != null ? String(note) : null,
      actorUserId: req.currentUser.id,
    });
    res.status(201).json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.patch("/vehicles/:vehicleId", async (req, res) => {
  try {
    const vehicleId = parseId(req.params.vehicleId);
    const { driverName, driverPhone, passengerSeats, meetingPlace, note } = req.body as Record<string, unknown>;
    const data = await updateVehicle(vehicleId, {
      ...(driverName !== undefined && { driverName: driverName != null ? String(driverName) : null }),
      ...(driverPhone !== undefined && { driverPhone: driverPhone != null ? String(driverPhone) : null }),
      ...(passengerSeats !== undefined && { passengerSeats: Number(passengerSeats) }),
      ...(meetingPlace !== undefined && { meetingPlace: meetingPlace != null ? String(meetingPlace) : null }),
      ...(note !== undefined && { note: note != null ? String(note) : null }),
    }, req.currentUser.id);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.delete("/vehicles/:vehicleId", async (req, res) => {
  try {
    const vehicleId = parseId(req.params.vehicleId);
    await deleteVehicle(vehicleId, req.currentUser.id);
    res.json({ data: null });
  } catch (err) {
    sendError(res, err);
  }
});

eventsRouter.post("/participants/:participantId/vehicle", async (req, res) => {
  try {
    const participantId = parseId(req.params.participantId);
    const { vehicleId } = req.body as Record<string, unknown>;
    await assignParticipantToVehicle(participantId, vehicleId as string | number, req.currentUser.id);
    res.json({ data: null });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /students/:studentId/events — handler exported for use in app.ts (bkz. product-sales.router.ts'deki eşdeğeri)
export async function listStudentEventBalancesHandler(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  try {
    const studentId = parseId(req.params.studentId);
    const data = await listEventBalancesForStudent(studentId);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
}
