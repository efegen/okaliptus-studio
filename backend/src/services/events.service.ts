// Etkinlik (event) modülü. Katılımcı borcu/ödemesi öğrencinin ana borç
// defterinden (lessons + product_sales) bilinçli olarak AYRI tutulur — bkz.
// migration 0261_events.sql başlığı. KPI/Hareketler bu tabloları hiç okumaz;
// öğrenci profili ayrıca sorgulayıp kendi kartında gösterir.

import type { PoolClient } from "pg";

import { pool } from "../db/connection.js";
import { createStudent } from "./students.service.js";
import {
  CompQuotaExceededError,
  DuplicateParticipantError,
  EventFeeItemNotFoundError,
  EventHasPaymentsError,
  EventNotFoundError,
  EventParticipantHasGuestsError,
  EventParticipantHasPaymentsError,
  EventParticipantNotFoundError,
  EventVehicleNotFoundError,
  OverpaymentNotAllowedError,
  StudentNotFoundError,
  ValidationError,
  VehicleFullError,
  toServiceError,
} from "./errors.js";
import {
  insertAuditLog,
  moneyToCents,
  normalizeMoneyInput,
  normalizeOptionalText,
  normalizeRequiredText,
  rollbackQuietly,
  type EntityId,
  type MoneyInput,
} from "./shared.js";

export type EventStatus = "upcoming" | "live" | "completed" | "cancelled";
export type ParticipantRole = "regular" | "invited" | "volunteer";
// "not_coming" bilinçli olarak yok — gelmeyecek kişi RSVP ile işaretlenmez,
// listeden doğrudan silinir (bkz. removeParticipant). "Gelmedi" (no-show)
// ayrı bir kavramdır: attendance_status, canlı etkinlik günü içindir.
export type RsvpStatus = "coming" | "unsure";
export type TransportMode = "needs_vehicle" | "self_arranged" | "unspecified";
export type AttendanceStatus = "pending" | "arrived" | "no_show";
export type VehicleType = "student_car" | "rental_service";
// Bir ücret kaleminin bedelini KİM karşılıyor — bkz. 0263_event_fee_coverage.sql.
// Yalnız "student" borç yaratır; "none" kişiyi kalemin sayımından da çıkarır.
export type FeeCoverage = "student" | "studio" | "comp" | "external" | "none";

const EVENT_STATUSES: EventStatus[] = ["upcoming", "live", "completed", "cancelled"];
const PARTICIPANT_ROLES: ParticipantRole[] = ["regular", "invited", "volunteer"];
const RSVP_STATUSES: RsvpStatus[] = ["coming", "unsure"];
const TRANSPORT_MODES: TransportMode[] = ["needs_vehicle", "self_arranged", "unspecified"];
const ATTENDANCE_STATUSES: AttendanceStatus[] = ["pending", "arrived", "no_show"];
const VEHICLE_TYPES: VehicleType[] = ["student_car", "rental_service"];
const FEE_COVERAGES: FeeCoverage[] = ["student", "studio", "comp", "external", "none"];

// Rol = ön ayar, kural değil. Ekleme ekranı bu ön ayarı gösterir ve kalem bazında
// değiştirilebilir (fees[] gönderilir); gönderilmezse burası uygulanır.
// Davetli/gönüllü "ücretsiz" değil "stüdyo üstlenir" demektir — kişi kalemi yine
// alır (restorana verilecek kişi sayısına girer), bedelini stüdyo öder.
const ROLE_FEE_PRESET: Record<ParticipantRole, FeeCoverage> = {
  regular: "student",
  invited: "studio",
  volunteer: "studio",
};

export function feeCoveragePresetFor(role: ParticipantRole): FeeCoverage {
  return ROLE_FEE_PRESET[role];
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: T[],
  fieldName: string,
): T {
  if (typeof value === "string" && (allowed as string[]).includes(value)) {
    return value as T;
  }
  throw new ValidationError(`${fieldName} must be one of: ${allowed.join(", ")}.`);
}

type EventRow = {
  id: string;
  name: string;
  starts_at: string;
  location: string | null;
  status: EventStatus;
  capacity_limit: number | null;
  transport_enabled: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type EventFeeItemRow = {
  id: string;
  event_id: string;
  label: string;
  amount: string;
  sort_order: number;
  comp_quota: number | null;
  is_pass_through: boolean;
  is_lesson_fee: boolean;
  comp_used: number;
};

export type EventParticipantFeeRow = {
  id: string;
  participant_id: string;
  fee_item_id: string;
  included: boolean;
  coverage: FeeCoverage;
  amount_snapshot: string;
  base_amount_snapshot: string;
  amount_override: string | null;
  paid_amount: string;
  label: string;
  is_pass_through: boolean;
  is_lesson_fee: boolean;
  comp_quota: number | null;
  comp_used: number;
};

// Ekleme/düzenleme sırasında kalem bazlı ön ayar override'ı.
export type ParticipantFeeInput = {
  feeItemId: EntityId;
  coverage: FeeCoverage;
};

export type EventParticipantRow = {
  id: string;
  event_id: string;
  student_id: string;
  role: ParticipantRole;
  rsvp_status: RsvpStatus;
  guest_of_participant_id: string | null;
  transport_mode: TransportMode;
  vehicle_id: string | null;
  attendance_status: AttendanceStatus;
  note: string | null;
  student_name: string;
  student_nickname: string | null;
  student_phone: string | null;
  guest_of_name: string | null;
  total_due: string;
  total_paid: string;
  total_studio_covered: string;
};

export type EventVehicleRow = {
  id: string;
  event_id: string;
  vehicle_type: VehicleType;
  driver_student_id: string | null;
  driver_student_name?: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  passenger_seats: number;
  meeting_time: string | null;
  meeting_place: string | null;
  note: string | null;
  seats_taken: number;
};

export type EventSummary = EventRow & {
  feeItems: EventFeeItemRow[];
  coming: number;
  unsure: number;
  totalParticipants: number;
  registeredCount: number;
  guestCount: number;
  potentialAmount: string;
  collectedAmount: string;
  // Stüdyonun üstlendiği (coverage='studio') tutar — geçiş kalemlerinde (kahvaltı
  // vb.) gerçek nakit yük, diğerlerinde vazgeçilen gelirdir.
  studioCoveredAmount: string;
};

export type CreateEventInput = {
  name: string;
  startsAt: string;
  location?: string | null;
  capacityLimit?: number | null;
  transportEnabled?: boolean;
  note?: string | null;
  feeItems?: Array<{
    label: string;
    amount: MoneyInput;
    compQuota?: number | null;
    isPassThrough?: boolean;
    isLessonFee?: boolean;
  }>;
  actorUserId?: number | string | null;
};

export type UpdateEventInput = {
  name?: string;
  startsAt?: string;
  location?: string | null;
  status?: EventStatus;
  capacityLimit?: number | null;
  transportEnabled?: boolean;
  note?: string | null;
};

export type AddExistingParticipantInput = {
  studentId: EntityId;
  role?: ParticipantRole;
  rsvpStatus?: RsvpStatus;
  guestOfParticipantId?: EntityId | null;
  transportMode?: TransportMode;
  fees?: ParticipantFeeInput[];
  actorUserId?: number | string | null;
};

export type AddNewParticipantInput = {
  fullName: string;
  phone?: string | null;
  role?: ParticipantRole;
  rsvpStatus?: RsvpStatus;
  guestOfParticipantId?: EntityId | null;
  transportMode?: TransportMode;
  fees?: ParticipantFeeInput[];
  actorUserId?: number | string | null;
};

export type UpdateParticipantInput = {
  role?: ParticipantRole;
  rsvpStatus?: RsvpStatus;
  transportMode?: TransportMode;
  attendanceStatus?: AttendanceStatus;
  note?: string | null;
};

export type CreateVehicleInput = {
  vehicleType: VehicleType;
  driverStudentId?: EntityId | null;
  driverName?: string | null;
  driverPhone?: string | null;
  passengerSeats: number;
  meetingTime?: string | null;
  meetingPlace?: string | null;
  note?: string | null;
  actorUserId?: number | string | null;
};

type Queryable = Pick<PoolClient, "query">;

async function lockEvent(client: PoolClient, eventId: EntityId): Promise<EventRow> {
  const result = await client.query<EventRow>(
    `SELECT * FROM events WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [eventId],
  );
  const event = result.rows[0];
  if (!event) throw new EventNotFoundError();
  return event;
}

const FEE_ITEM_SELECT = `
  SELECT i.id, i.event_id, i.label, i.amount, i.sort_order, i.comp_quota, i.is_pass_through,
         i.is_lesson_fee, COALESCE(c.comp_used, 0)::int AS comp_used
    FROM event_fee_items i
    LEFT JOIN (
      SELECT fee_item_id, COUNT(*) AS comp_used
        FROM event_participant_fees
       WHERE coverage = 'comp'
       GROUP BY fee_item_id
    ) c ON c.fee_item_id = i.id
`;

async function fetchFeeItems(client: Queryable, eventId: EntityId): Promise<EventFeeItemRow[]> {
  const result = await client.query<EventFeeItemRow>(
    `${FEE_ITEM_SELECT}
      WHERE i.event_id = $1
      ORDER BY i.sort_order ASC, i.id ASC`,
    [eventId],
  );
  return result.rows;
}

function normalizeCompQuota(value: unknown): number | null {
  if (value == null || value === "") return null;
  const quota = Number(value);
  if (!Number.isInteger(quota) || quota < 0) {
    throw new ValidationError("compQuota must be a non-negative integer or null.");
  }
  return quota;
}

type LockedFeeItem = {
  id: string;
  label: string;
  amount: string;
  comp_quota: number | null;
  is_lesson_fee: boolean;
};

// Kontenjan sayımının doğru olması için kalem satırı kilitlenir: iki eşzamanlı
// "ücretsiz kontenjandan" ataması aynı son slotu paylaşamaz. Tüm yollarda kilit
// sırası aynıdır — event → fee_item → participant_fee.
async function lockFeeItem(client: PoolClient, feeItemId: EntityId): Promise<LockedFeeItem> {
  const result = await client.query<LockedFeeItem>(
    `SELECT id, label, amount, comp_quota, is_lesson_fee FROM event_fee_items WHERE id = $1 FOR UPDATE`,
    [feeItemId],
  );
  const item = result.rows[0];
  if (!item) throw new EventFeeItemNotFoundError();
  return item;
}

// Ücretsiz kontenjan bilinçli olarak "gelme durumu"ndan bağımsız tutulur: slot
// atandığı anda rezerve olur. Aksi halde "gelmiyor" işaretli biri geri dönünce
// kontenjan sessizce aşılabilirdi — kontenjan boşaltmak operatörün kararıdır.
async function assertCompQuotaAvailable(
  client: PoolClient,
  item: LockedFeeItem,
  excludeParticipantId: EntityId | null,
): Promise<void> {
  if (item.comp_quota == null) {
    throw new ValidationError(`"${item.label}" kaleminde ücretsiz kontenjan tanımlı değil.`);
  }
  const usedResult = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM event_participant_fees
      WHERE fee_item_id = $1 AND coverage = 'comp'
        AND ($2::bigint IS NULL OR participant_id <> $2)`,
    [item.id, excludeParticipantId],
  );
  if (Number(usedResult.rows[0].count) >= item.comp_quota) {
    throw new CompQuotaExceededError(
      `"${item.label}" için ücretsiz kontenjan dolu (${item.comp_quota} kişi).`,
    );
  }
}

// Ders ücreti stüdyonun kendi geliridir — "stüdyo karşılar"/"kendi öder" burada
// gerçek bir masraf temsil etmez, sabit bir kural olarak bu kalemde sunulmaz
// (bkz. src/mobile/events/feeCoverage.jsx coverageOptionsFor — istemci tarafı
// aynası). Sunucu burada ikinci savunma hattı: istemci ne gönderirse göndersin
// reddedilir.
function assertCoverageAllowedForItem(
  item: { label: string; is_lesson_fee: boolean },
  coverage: FeeCoverage,
): void {
  if (item.is_lesson_fee && (coverage === "studio" || coverage === "external")) {
    throw new ValidationError(
      `"${item.label}" ders ücreti kalemi için "${coverage}" seçilemez — bu kalem yalnız tahsil edilir ya da edilmez.`,
    );
  }
}

// fees[] içindeki kalem id'leri bu etkinliğe ait olmalı; olmayanlar sessizce
// yutulmaz çünkü yanlış kaleme "stüdyo karşılıyor" demek para hatasıdır.
function buildCoverageOverrides(
  fees: ParticipantFeeInput[] | undefined,
  feeItems: EventFeeItemRow[],
): Map<string, FeeCoverage> {
  const overrides = new Map<string, FeeCoverage>();
  if (!fees) return overrides;
  const byId = new Map(feeItems.map((item) => [String(item.id), item]));
  for (const fee of fees) {
    const feeItemId = String(fee.feeItemId ?? "");
    const item = byId.get(feeItemId);
    if (!item) {
      throw new EventFeeItemNotFoundError("fees[].feeItemId must belong to this event.");
    }
    const coverage = normalizeEnum(fee.coverage, FEE_COVERAGES, "fees[].coverage");
    assertCoverageAllowedForItem(item, coverage);
    overrides.set(feeItemId, coverage);
  }
  return overrides;
}

// Rol ön ayarı uygulanır, fees[] ile kalem kalem ezilebilir — "derse para
// ödemiyor ama kahvaltıya ödüyor" gibi karışık haller ancak böyle kurulabilir.
async function createFeeRowsForParticipant(
  client: PoolClient,
  participantId: EntityId,
  eventId: EntityId,
  role: ParticipantRole,
  fees?: ParticipantFeeInput[],
): Promise<void> {
  const feeItems = await fetchFeeItems(client, eventId);
  const overrides = buildCoverageOverrides(fees, feeItems);
  const rolePreset = ROLE_FEE_PRESET[role];

  for (const item of feeItems) {
    // "studio" ön ayarı ders ücretinde geçerli değil — bkz. coverageOptionsFor.
    const preset = rolePreset === "studio" && item.is_lesson_fee ? "none" : rolePreset;
    const coverage = overrides.get(String(item.id)) ?? preset;
    if (coverage === "comp") {
      await assertCompQuotaAvailable(client, await lockFeeItem(client, item.id), participantId);
    }
    await client.query(
      `INSERT INTO event_participant_fees (
         participant_id, fee_item_id, included, coverage, amount_snapshot, base_amount_snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        participantId,
        item.id,
        coverage !== "none",
        coverage,
        coverage === "student" ? item.amount : "0.00",
        item.amount,
      ],
    );
  }
}

export async function createEvent(input: CreateEventInput): Promise<EventRow> {
  const client = await pool.connect();

  try {
    const name = normalizeRequiredText(input.name, "name");
    if (!input.startsAt) throw new ValidationError("startsAt is required.");
    if (input.capacityLimit != null && (!Number.isInteger(input.capacityLimit) || input.capacityLimit <= 0)) {
      throw new ValidationError("capacityLimit must be a positive integer or null.");
    }

    await client.query("BEGIN");

    const eventResult = await client.query<EventRow>(
      `INSERT INTO events (name, starts_at, location, capacity_limit, transport_enabled, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        name,
        input.startsAt,
        normalizeOptionalText(input.location),
        input.capacityLimit ?? null,
        input.transportEnabled ?? false,
        normalizeOptionalText(input.note),
      ],
    );
    const event = eventResult.rows[0];

    for (const [index, item] of (input.feeItems ?? []).entries()) {
      const label = normalizeRequiredText(item.label, "feeItems[].label");
      const amount = normalizeMoneyInput(item.amount, "feeItems[].amount", { allowZero: true });
      await client.query(
        `INSERT INTO event_fee_items (event_id, label, amount, sort_order, comp_quota, is_pass_through, is_lesson_fee)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          event.id,
          label,
          amount,
          index,
          normalizeCompQuota(item.compQuota),
          item.isPassThrough ?? false,
          item.isLessonFee ?? false,
        ],
      );
    }

    await insertAuditLog(client, {
      action: "event_created",
      entityType: "event",
      entityId: event.id,
      after: event,
      actorUserId: input.actorUserId ?? null,
    });

    await client.query("COMMIT");
    return event;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function listEvents(input: { status?: EventStatus } = {}): Promise<EventSummary[]> {
  const status = input.status;
  const result = await pool.query<EventRow>(
    `SELECT * FROM events
      WHERE deleted_at IS NULL
        AND ($1::text IS NULL OR status = $1)
      ORDER BY starts_at ASC`,
    [status ?? null],
  );
  return Promise.all(result.rows.map((event) => attachSummary(event)));
}

// Ana sayfa kartı (4d) için: en yakın upcoming/live etkinlik, yoksa null.
export async function getUpcomingEvent(): Promise<EventSummary | null> {
  const result = await pool.query<EventRow>(
    `SELECT * FROM events
      WHERE deleted_at IS NULL AND status IN ('upcoming', 'live')
      ORDER BY starts_at ASC
      LIMIT 1`,
  );
  const event = result.rows[0];
  return event ? attachSummary(event) : null;
}

export async function getEventById(eventId: EntityId): Promise<EventSummary> {
  const result = await pool.query<EventRow>(
    `SELECT * FROM events WHERE id = $1 AND deleted_at IS NULL`,
    [eventId],
  );
  const event = result.rows[0];
  if (!event) throw new EventNotFoundError();
  return attachSummary(event);
}

async function attachSummary(event: EventRow): Promise<EventSummary> {
  const [feeItems, statsResult] = await Promise.all([
    fetchFeeItems(pool, event.id),
    pool.query<{
      coming: string;
      unsure: string;
      total: string;
      registered: string;
      guests: string;
      potential_amount: string;
      collected_amount: string;
      studio_covered_amount: string;
    }>(
      // event_participant_fees katılımcı başına birden çok satır verdiği için
      // (bir kalem her fee_item için) katılımcı sayıları DISTINCT olmalı —
      // yoksa kalem sayısı kadar tekrar sayılır.
      `SELECT
         COUNT(DISTINCT p.id) FILTER (WHERE p.rsvp_status = 'coming') AS coming,
         COUNT(DISTINCT p.id) FILTER (WHERE p.rsvp_status = 'unsure') AS unsure,
         COUNT(DISTINCT p.id) AS total,
         COUNT(DISTINCT p.id) FILTER (WHERE p.guest_of_participant_id IS NULL) AS registered,
         COUNT(DISTINCT p.id) FILTER (WHERE p.guest_of_participant_id IS NOT NULL) AS guests,
         COALESCE(SUM(f.amount_snapshot) FILTER (
           WHERE f.included AND p.rsvp_status IN ('coming', 'unsure')
         ), 0)::text AS potential_amount,
         COALESCE(SUM(f.paid_amount), 0)::text AS collected_amount,
         COALESCE(SUM(f.base_amount_snapshot) FILTER (
           WHERE f.coverage = 'studio' AND p.rsvp_status IN ('coming', 'unsure')
         ), 0)::text AS studio_covered_amount
       FROM event_participants p
       LEFT JOIN event_participant_fees f ON f.participant_id = p.id
       WHERE p.event_id = $1`,
      [event.id],
    ),
  ]);
  const stats = statsResult.rows[0];

  return {
    ...event,
    feeItems,
    coming: Number(stats?.coming ?? 0),
    unsure: Number(stats?.unsure ?? 0),
    totalParticipants: Number(stats?.total ?? 0),
    registeredCount: Number(stats?.registered ?? 0),
    guestCount: Number(stats?.guests ?? 0),
    potentialAmount: stats?.potential_amount ?? "0.00",
    collectedAmount: stats?.collected_amount ?? "0.00",
    studioCoveredAmount: stats?.studio_covered_amount ?? "0.00",
  };
}

export async function updateEvent(
  eventId: EntityId,
  input: UpdateEventInput,
  actorUserId?: number | string | null,
): Promise<EventRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const before = await lockEvent(client, eventId);

    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      values.push(normalizeRequiredText(input.name, "name"));
      sets.push(`name = $${values.length}`);
    }
    if (input.startsAt !== undefined) {
      values.push(input.startsAt);
      sets.push(`starts_at = $${values.length}`);
    }
    if (input.location !== undefined) {
      values.push(normalizeOptionalText(input.location));
      sets.push(`location = $${values.length}`);
    }
    if (input.status !== undefined) {
      values.push(normalizeEnum(input.status, EVENT_STATUSES, "status"));
      sets.push(`status = $${values.length}`);
    }
    if (input.capacityLimit !== undefined) {
      if (input.capacityLimit != null && (!Number.isInteger(input.capacityLimit) || input.capacityLimit <= 0)) {
        throw new ValidationError("capacityLimit must be a positive integer or null.");
      }
      if (input.capacityLimit != null) {
        const countResult = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM event_participants WHERE event_id = $1`,
          [eventId],
        );
        if (Number(countResult.rows[0].count) > input.capacityLimit) {
          throw new ValidationError(
            `Kontenjan, mevcut katılımcı sayısının (${countResult.rows[0].count}) altına düşürülemez.`,
          );
        }
      }
      values.push(input.capacityLimit);
      sets.push(`capacity_limit = $${values.length}`);
    }
    if (input.transportEnabled !== undefined) {
      values.push(input.transportEnabled);
      sets.push(`transport_enabled = $${values.length}`);
    }
    if (input.note !== undefined) {
      values.push(normalizeOptionalText(input.note));
      sets.push(`note = $${values.length}`);
    }

    if (sets.length === 0) {
      await client.query("COMMIT");
      return before;
    }

    values.push(String(eventId));
    const updateResult = await client.query<EventRow>(
      `UPDATE events SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    const updated = updateResult.rows[0];

    await insertAuditLog(client, {
      action: "event_updated",
      entityType: "event",
      entityId: updated.id,
      before,
      after: updated,
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// Etkinlik ayarları → "Tehlikeli bölge". Soft delete (deleted_at) — kayıt fiziksel
// olarak silinmez, yalnız listelerden/özet sorgulardan düşer (tüm event
// sorguları zaten WHERE deleted_at IS NULL kullanıyor). Tahsil edilmiş ödemesi
// olan bir etkinlik silinemez — para hareketi geri dönüşsüz kaybolmasın diye;
// bu durumda operatör önce "iptal et" (status=cancelled) yolunu kullanmalı.
export async function deleteEvent(
  eventId: EntityId,
  actorUserId?: number | string | null,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const before = await lockEvent(client, eventId);

    const paidResult = await client.query<{ paid: string }>(
      `SELECT COALESCE(SUM(f.paid_amount), 0)::text AS paid
         FROM event_participant_fees f
         JOIN event_participants p ON p.id = f.participant_id
        WHERE p.event_id = $1`,
      [eventId],
    );
    if (Number(paidResult.rows[0].paid) > 0) {
      throw new EventHasPaymentsError();
    }

    await client.query(`UPDATE events SET deleted_at = now() WHERE id = $1`, [eventId]);

    await insertAuditLog(client, {
      action: "event_deleted",
      entityType: "event",
      entityId: String(eventId),
      before,
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function addFeeItem(
  eventId: EntityId,
  input: { label: string; amount: MoneyInput; compQuota?: number | null; isPassThrough?: boolean },
  actorUserId?: number | string | null,
): Promise<EventFeeItemRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await lockEvent(client, eventId);

    const label = normalizeRequiredText(input.label, "label");
    const amount = normalizeMoneyInput(input.amount, "amount", { allowZero: true });

    const sortResult = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM event_fee_items WHERE event_id = $1`,
      [eventId],
    );

    const insertResult = await client.query<Omit<EventFeeItemRow, "comp_used">>(
      `INSERT INTO event_fee_items (event_id, label, amount, sort_order, comp_quota, is_pass_through)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, event_id, label, amount, sort_order, comp_quota, is_pass_through`,
      [
        eventId,
        label,
        amount,
        sortResult.rows[0].next,
        normalizeCompQuota(input.compQuota),
        input.isPassThrough ?? false,
      ],
    );
    const feeItem: EventFeeItemRow = { ...insertResult.rows[0], comp_used: 0 };

    // Mevcut katılımcılara da bu yeni kalem için satır aç — rol ön ayarıyla.
    // Kimseye otomatik "ücretsiz kontenjan" verilmez (ön ayarlarda comp yok).
    const participants = await client.query<{ id: string; role: ParticipantRole }>(
      `SELECT id, role FROM event_participants WHERE event_id = $1`,
      [eventId],
    );
    for (const participant of participants.rows) {
      const coverage = ROLE_FEE_PRESET[participant.role];
      await client.query(
        `INSERT INTO event_participant_fees (
           participant_id, fee_item_id, included, coverage, amount_snapshot, base_amount_snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          participant.id,
          feeItem.id,
          coverage !== "none",
          coverage,
          coverage === "student" ? amount : "0.00",
          amount,
        ],
      );
    }

    await insertAuditLog(client, {
      action: "event_fee_item_created",
      entityType: "event_fee_item",
      entityId: feeItem.id,
      after: feeItem,
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
    return feeItem;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

const PARTICIPANT_SELECT = `
  SELECT
    p.id, p.event_id, p.student_id, p.role, p.rsvp_status, p.guest_of_participant_id,
    p.transport_mode, p.vehicle_id, p.attendance_status, p.note,
    s.full_name AS student_name, s.nickname AS student_nickname, s.phone AS student_phone,
    g.full_name AS guest_of_name,
    COALESCE(SUM(f.amount_snapshot) FILTER (WHERE f.included), 0)::text AS total_due,
    COALESCE(SUM(f.paid_amount), 0)::text AS total_paid,
    COALESCE(SUM(f.base_amount_snapshot) FILTER (WHERE f.coverage = 'studio'), 0)::text
      AS total_studio_covered
  FROM event_participants p
  JOIN students s ON s.id = p.student_id
  LEFT JOIN event_participants gp ON gp.id = p.guest_of_participant_id
  LEFT JOIN students g ON g.id = gp.student_id
  LEFT JOIN event_participant_fees f ON f.participant_id = p.id
`;
const PARTICIPANT_GROUP_BY = `
  GROUP BY p.id, s.full_name, s.nickname, s.phone, g.full_name
`;

export async function listParticipants(eventId: EntityId): Promise<EventParticipantRow[]> {
  const result = await pool.query<EventParticipantRow>(
    `${PARTICIPANT_SELECT}
     WHERE p.event_id = $1
     ${PARTICIPANT_GROUP_BY}
     ORDER BY s.full_name ASC`,
    [eventId],
  );
  return result.rows;
}

export async function getParticipantById(participantId: EntityId): Promise<EventParticipantRow> {
  const result = await pool.query<EventParticipantRow>(
    `${PARTICIPANT_SELECT} WHERE p.id = $1 ${PARTICIPANT_GROUP_BY}`,
    [participantId],
  );
  const participant = result.rows[0];
  if (!participant) throw new EventParticipantNotFoundError();
  return participant;
}

export async function listParticipantFees(participantId: EntityId): Promise<EventParticipantFeeRow[]> {
  const result = await pool.query<EventParticipantFeeRow>(
    `SELECT f.id, f.participant_id, f.fee_item_id, f.included, f.coverage,
            f.amount_snapshot, f.base_amount_snapshot, f.amount_override, f.paid_amount,
            i.label, i.is_pass_through, i.is_lesson_fee, i.comp_quota,
            COALESCE(c.comp_used, 0)::int AS comp_used
       FROM event_participant_fees f
       JOIN event_fee_items i ON i.id = f.fee_item_id
       LEFT JOIN (
         SELECT fee_item_id, COUNT(*) AS comp_used
           FROM event_participant_fees
          WHERE coverage = 'comp'
          GROUP BY fee_item_id
       ) c ON c.fee_item_id = i.id
      WHERE f.participant_id = $1
      ORDER BY i.sort_order ASC, i.id ASC`,
    [participantId],
  );
  return result.rows;
}

// 6a: "önce kayıtlı öğrencilerde ara" — isim/telefonla arar, bu etkinlikte zaten
// var mı işaretler.
export async function searchStudentsForEvent(
  eventId: EntityId,
  query: string,
): Promise<Array<{ id: string; full_name: string; nickname: string | null; phone: string | null; already_in_event: boolean }>> {
  const q = `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
  const result = await pool.query<{
    id: string;
    full_name: string;
    nickname: string | null;
    phone: string | null;
    already_in_event: boolean;
  }>(
    `SELECT s.id, s.full_name, s.nickname, s.phone,
            EXISTS (
              SELECT 1 FROM event_participants p
               WHERE p.event_id = $1 AND p.student_id = s.id
            ) AS already_in_event
       FROM students s
      WHERE s.deleted_at IS NULL
        AND (s.full_name ILIKE $2 OR COALESCE(s.nickname, '') ILIKE $2 OR COALESCE(s.phone, '') ILIKE $2)
      ORDER BY s.full_name ASC
      LIMIT 20`,
    [eventId, q],
  );
  return result.rows;
}

async function assertCapacityAvailable(client: PoolClient, eventId: EntityId): Promise<void> {
  const event = await lockEvent(client, eventId);
  if (event.capacity_limit == null) return;

  const countResult = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM event_participants WHERE event_id = $1`,
    [eventId],
  );
  if (Number(countResult.rows[0].count) >= event.capacity_limit) {
    throw new ValidationError("Etkinlik kontenjanı dolu.");
  }
}

async function assertGuestOfValid(
  client: PoolClient,
  eventId: EntityId,
  guestOfParticipantId: EntityId | null | undefined,
): Promise<string | null> {
  if (guestOfParticipantId == null || guestOfParticipantId === "") return null;
  const result = await client.query<{ id: string }>(
    `SELECT id FROM event_participants WHERE id = $1 AND event_id = $2`,
    [guestOfParticipantId, eventId],
  );
  if (!result.rows[0]) {
    throw new ValidationError("guestOfParticipantId must belong to the same event.");
  }
  return String(guestOfParticipantId);
}

export async function addExistingParticipant(
  eventId: EntityId,
  input: AddExistingParticipantInput,
): Promise<EventParticipantRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const studentResult = await client.query<{ id: string; deleted_at: string | null }>(
      `SELECT id, deleted_at FROM students WHERE id = $1 FOR SHARE`,
      [input.studentId],
    );
    const student = studentResult.rows[0];
    if (!student || student.deleted_at !== null) throw new StudentNotFoundError();

    // Zaten listedeyse kontenjan dolu olsa bile DUPLICATE_PARTICIPANT dönmeli —
    // yer kaplamıyor, sadece tekrar eklenemez.
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM event_participants WHERE event_id = $1 AND student_id = $2`,
      [eventId, input.studentId],
    );
    if (existing.rows[0]) throw new DuplicateParticipantError();

    await assertCapacityAvailable(client, eventId);

    const role = input.role ? normalizeEnum(input.role, PARTICIPANT_ROLES, "role") : "regular";
    const rsvpStatus = input.rsvpStatus
      ? normalizeEnum(input.rsvpStatus, RSVP_STATUSES, "rsvpStatus")
      : "unsure";
    const transportMode = input.transportMode
      ? normalizeEnum(input.transportMode, TRANSPORT_MODES, "transportMode")
      : "unspecified";
    const guestOfParticipantId = await assertGuestOfValid(client, eventId, input.guestOfParticipantId);

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO event_participants (
         event_id, student_id, role, rsvp_status, guest_of_participant_id, transport_mode
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [eventId, input.studentId, role, rsvpStatus, guestOfParticipantId, transportMode],
    );
    const participantId = insertResult.rows[0].id;

    await createFeeRowsForParticipant(client, participantId, eventId, role, input.fees);

    await insertAuditLog(client, {
      action: "event_participant_added",
      entityType: "event_participant",
      entityId: participantId,
      after: { eventId: String(eventId), studentId: String(input.studentId), role, rsvpStatus },
      actorUserId: input.actorUserId ?? null,
    });

    await client.query("COMMIT");
    return getParticipantById(participantId);
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// 6c: yeni kişi oluşturup aynı anda etkinliğe ekler. Öğrenci kaydı önce, kendi
// transaction'ında, mevcut createStudent() ile açılır (öğrenci listesine de
// kaydedilir — tam sizin belirttiğiniz gibi); ardından katılımcı satırı ayrı bir
// transaction'da eklenir. Katılımcı ekleme başarısız olursa öğrenci kaydı
// silinmez — bu, gerçek bir öğrenci kaydı, sadece etkinliğe eklenmemiş demektir.
export async function addNewParticipant(
  eventId: EntityId,
  input: AddNewParticipantInput,
): Promise<EventParticipantRow> {
  const student = await createStudent({
    fullName: input.fullName,
    phone: input.phone ?? null,
    actorUserId: input.actorUserId ?? null,
  });

  return addExistingParticipant(eventId, {
    studentId: student.id,
    role: input.role,
    rsvpStatus: input.rsvpStatus,
    guestOfParticipantId: input.guestOfParticipantId,
    transportMode: input.transportMode,
    fees: input.fees,
    actorUserId: input.actorUserId,
  });
}

export async function updateParticipant(
  participantId: EntityId,
  input: UpdateParticipantInput,
  actorUserId?: number | string | null,
): Promise<EventParticipantRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentResult = await client.query<{ id: string; event_id: string; role: ParticipantRole }>(
      `SELECT id, event_id, role FROM event_participants WHERE id = $1 FOR UPDATE`,
      [participantId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new EventParticipantNotFoundError();

    const sets: string[] = [];
    const values: unknown[] = [];
    let roleChangedTo: ParticipantRole | null = null;

    if (input.role !== undefined) {
      const role = normalizeEnum(input.role, PARTICIPANT_ROLES, "role");
      if (role !== current.role) roleChangedTo = role;
      values.push(role);
      sets.push(`role = $${values.length}`);
    }
    if (input.rsvpStatus !== undefined) {
      values.push(normalizeEnum(input.rsvpStatus, RSVP_STATUSES, "rsvpStatus"));
      sets.push(`rsvp_status = $${values.length}`);
    }
    if (input.transportMode !== undefined) {
      values.push(normalizeEnum(input.transportMode, TRANSPORT_MODES, "transportMode"));
      sets.push(`transport_mode = $${values.length}`);
      if (input.transportMode !== "needs_vehicle") {
        sets.push(`vehicle_id = NULL`);
      }
    }
    if (input.attendanceStatus !== undefined) {
      values.push(normalizeEnum(input.attendanceStatus, ATTENDANCE_STATUSES, "attendanceStatus"));
      sets.push(`attendance_status = $${values.length}`);
    }
    if (input.note !== undefined) {
      values.push(normalizeOptionalText(input.note));
      sets.push(`note = $${values.length}`);
    }

    if (sets.length > 0) {
      values.push(String(participantId));
      await client.query(
        `UPDATE event_participants SET ${sets.join(", ")} WHERE id = $${values.length}`,
        values,
      );
    }

    // Rol değişince kalemler yeni rolün ÖN AYARINA döner — kalem bazlı
    // özelleştirmeler (örn. "sadece kahvaltıya ödüyor") bilinçli olarak sıfırlanır;
    // rol değişimi zaten "bu kişinin durumu baştan farklı" demektir. Ödemesi
    // alınmış kalemlere dokunulmaz. Ön ayarlarda comp yok, yani kontenjan slotu
    // asla otomatik işgal edilmez (varsa serbest bırakılır).
    if (roleChangedTo !== null) {
      const feeRows = await client.query<{
        fee_item_id: string;
        base_amount_snapshot: string;
        paid_amount: string;
        coverage: FeeCoverage;
        is_lesson_fee: boolean;
      }>(
        `SELECT f.fee_item_id, f.base_amount_snapshot, f.paid_amount, f.coverage, i.is_lesson_fee
           FROM event_participant_fees f
           JOIN event_fee_items i ON i.id = f.fee_item_id
          WHERE f.participant_id = $1
          FOR UPDATE OF f`,
        [participantId],
      );
      const rolePreset = ROLE_FEE_PRESET[roleChangedTo];
      for (const row of feeRows.rows) {
        if (Number(row.paid_amount) > 0) continue; // Zaten ödenmiş kalem geriye dönük değişmez.
        // "studio" ön ayarı ders ücretinde geçerli değil — orada gerçek bir
        // masraf oluşmaz, o yüzden "almıyor"a düşer (bkz. coverageOptionsFor).
        const preset = rolePreset === "studio" && row.is_lesson_fee ? "none" : rolePreset;
        await client.query(
          `UPDATE event_participant_fees SET included = $1, coverage = $2, amount_snapshot = $3,
                  amount_override = NULL
            WHERE participant_id = $4 AND fee_item_id = $5`,
          [
            preset !== "none",
            preset,
            preset === "student" ? row.base_amount_snapshot : "0.00",
            participantId,
            row.fee_item_id,
          ],
        );
      }
    }

    await insertAuditLog(client, {
      action: "event_participant_updated",
      entityType: "event_participant",
      entityId: String(participantId),
      after: input,
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
    return await getParticipantById(participantId);
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// RSVP'de "gelmiyor" seçeneği yok — gelmeyecek kişi işaretlenmez, doğrudan
// listeden silinir. Ödemesi tahsil edilmiş bir katılımcı silinemez (para
// hareketi geri dönüşsüz kaybolmasın diye, bkz. deleteEvent'teki aynı kural);
// misafiri olan biri de silinemez (guest_of_participant_id'de FK NO ACTION
// zaten reddeder, burada önceden anlaşılır bir hata verilir).
export async function removeParticipant(
  participantId: EntityId,
  actorUserId?: number | string | null,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentResult = await client.query<{ id: string; event_id: string; student_id: string; role: ParticipantRole; rsvp_status: RsvpStatus }>(
      `SELECT id, event_id, student_id, role, rsvp_status FROM event_participants WHERE id = $1 FOR UPDATE`,
      [participantId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new EventParticipantNotFoundError();

    const guestResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM event_participants WHERE guest_of_participant_id = $1`,
      [participantId],
    );
    if (Number(guestResult.rows[0].count) > 0) {
      throw new EventParticipantHasGuestsError();
    }

    const paidResult = await client.query<{ paid_amount: string }>(
      `SELECT paid_amount FROM event_participant_fees WHERE participant_id = $1 FOR UPDATE`,
      [participantId],
    );
    if (paidResult.rows.some((row) => Number(row.paid_amount) > 0)) {
      throw new EventParticipantHasPaymentsError();
    }

    await client.query(`DELETE FROM event_participants WHERE id = $1`, [participantId]);

    await insertAuditLog(client, {
      action: "event_participant_removed",
      entityType: "event_participant",
      entityId: String(participantId),
      before: current,
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// Tek bir katılımcının tek bir kalemini kim karşılıyor sorusunu değiştirir.
// Ödenmemiş, öğrenciye yazılan ders ücretine özel tutar atanabilir (0272).
// input.included eski (0261) çağrılar için korunur: false → "almıyor".
export async function updateParticipantFee(
  participantId: EntityId,
  feeItemId: EntityId,
  input: { coverage?: FeeCoverage; included?: boolean; amount?: MoneyInput },
  actorUserId?: number | string | null,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Kilit sırası: fee_item → participant_fee (bkz. lockFeeItem).
    const item = await lockFeeItem(client, feeItemId);
    const feeResult = await client.query<{
      amount_snapshot: string;
      base_amount_snapshot: string;
      amount_override: string | null;
      paid_amount: string;
      coverage: FeeCoverage;
    }>(
      `SELECT amount_snapshot, base_amount_snapshot, amount_override, paid_amount, coverage
         FROM event_participant_fees
        WHERE participant_id = $1 AND fee_item_id = $2
        FOR UPDATE`,
      [participantId, feeItemId],
    );
    const fee = feeResult.rows[0];
    if (!fee) throw new EventFeeItemNotFoundError();
    const coverage: FeeCoverage = input.coverage !== undefined
      ? normalizeEnum(input.coverage, FEE_COVERAGES, "coverage")
      : input.included !== undefined
        ? (input.included ? "student" : "none")
        : fee.coverage;
    assertCoverageAllowedForItem(item, coverage);
    if (coverage === "comp") {
      await assertCompQuotaAvailable(client, item, participantId);
    }
    // Tahsil edilmiş para "stüdyo karşılıyor"a çevrilerek kaybedilemez; önce
    // ödeme geri alınmalı (v1'de sistem dışı bir operatör işi).
    if (coverage !== "student" && Number(fee.paid_amount) > 0) {
      throw new ValidationError(
        "Ödemesi alınmış bir kalem başkasının üstlenmesine çevrilemez.",
      );
    }

    let amountOverride = coverage === "student" ? fee.amount_override : null;
    if (input.amount !== undefined) {
      if (!item.is_lesson_fee || fee.coverage !== "student" || coverage !== "student") {
        throw new ValidationError("Yalnız öğrencinin ödeyeceği ders ücreti değiştirilebilir.");
      }
      if (Number(fee.paid_amount) > 0) {
        throw new ValidationError("Ödemesi alınmış ders ücreti değiştirilemez.");
      }
      try {
        amountOverride = normalizeMoneyInput(input.amount, "amount", { allowZero: true });
        if (moneyToCents(amountOverride) > 999999999999n) throw new Error("out of range");
      } catch {
        throw new ValidationError("0 ile 9.999.999.999,99 TL arasında, en fazla iki ondalıklı bir tutar girin.");
      }
    }
    const amountSnapshot = coverage === "student"
      ? (amountOverride ?? fee.base_amount_snapshot) : "0.00";

    await client.query(
      `UPDATE event_participant_fees SET included = $1, coverage = $2, amount_snapshot = $3,
              amount_override = $6
        WHERE participant_id = $4 AND fee_item_id = $5`,
      [
        coverage !== "none",
        coverage,
        amountSnapshot,
        participantId,
        feeItemId,
        amountOverride,
      ],
    );

    await insertAuditLog(client, {
      action: "event_participant_fee_updated",
      entityType: "event_participant_fee",
      entityId: String(participantId),
      before: { feeItemId: String(feeItemId), coverage: fee.coverage, amount: fee.amount_snapshot },
      after: { feeItemId: String(feeItemId), coverage, amount: amountSnapshot },
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// Tek tutar girilir, katılımcının ödenmemiş dahil kalemlerine sırayla (FIFO)
// dağıtılır — 5a/6b'de tek "ödeme al" aksiyonu bunun üzerine kurulu, kalem
// bazlı tahsilat ekranı yok.
export async function recordParticipantPayment(
  participantId: EntityId,
  amount: MoneyInput,
  actorUserId?: number | string | null,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const participantResult = await client.query<{ id: string }>(
      `SELECT id FROM event_participants WHERE id = $1 FOR UPDATE`,
      [participantId],
    );
    if (!participantResult.rows[0]) throw new EventParticipantNotFoundError();

    const feeRows = await client.query<{ fee_item_id: string; amount_snapshot: string; paid_amount: string }>(
      `SELECT fee_item_id, amount_snapshot, paid_amount
         FROM event_participant_fees
        WHERE participant_id = $1 AND included = true AND paid_amount < amount_snapshot
        ORDER BY fee_item_id ASC
        FOR UPDATE`,
      [participantId],
    );

    let remainingCents = moneyToCents(normalizeMoneyInput(amount, "amount"), "amount");
    const totalOpenCents = feeRows.rows.reduce(
      (sum, row) => sum + (moneyToCents(row.amount_snapshot) - moneyToCents(row.paid_amount)),
      0n,
    );
    if (remainingCents > totalOpenCents) {
      throw new OverpaymentNotAllowedError();
    }

    for (const row of feeRows.rows) {
      if (remainingCents <= 0n) break;
      const openCents = moneyToCents(row.amount_snapshot) - moneyToCents(row.paid_amount);
      const applyCents = openCents < remainingCents ? openCents : remainingCents;
      if (applyCents <= 0n) continue;
      remainingCents -= applyCents;
      await client.query(
        `UPDATE event_participant_fees SET paid_amount = paid_amount + $1
          WHERE participant_id = $2 AND fee_item_id = $3`,
        [(Number(applyCents) / 100).toFixed(2), participantId, row.fee_item_id],
      );
    }

    await insertAuditLog(client, {
      action: "event_participant_payment_recorded",
      entityType: "event_participant",
      entityId: String(participantId),
      after: { amount: normalizeMoneyInput(amount, "amount") },
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function listVehicles(eventId: EntityId): Promise<EventVehicleRow[]> {
  const result = await pool.query<EventVehicleRow>(
    // driver_student_id sahibi etkinliğe katılımcı olarak eklenmemiş olabilir
    // (ör. sadece şoförlük yapıyor) — isim yine de students'tan gösterilir.
    `SELECT v.*, COALESCE(r.seats_taken, 0)::int AS seats_taken, s.full_name AS driver_student_name
       FROM event_vehicles v
       LEFT JOIN students s ON s.id = v.driver_student_id
       LEFT JOIN (
         SELECT vehicle_id, COUNT(*) AS seats_taken
           FROM event_participants
          WHERE vehicle_id IS NOT NULL
          GROUP BY vehicle_id
       ) r ON r.vehicle_id = v.id
      WHERE v.event_id = $1
      ORDER BY v.id ASC`,
    [eventId],
  );
  return result.rows;
}

export async function createVehicle(
  eventId: EntityId,
  input: CreateVehicleInput,
): Promise<EventVehicleRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await lockEvent(client, eventId);

    const vehicleType = normalizeEnum(input.vehicleType, VEHICLE_TYPES, "vehicleType");
    const driverName = normalizeOptionalText(input.driverName);
    if (input.driverStudentId == null && driverName == null) {
      throw new ValidationError("driverStudentId or driverName is required.");
    }
    if (!Number.isInteger(input.passengerSeats) || input.passengerSeats <= 0) {
      throw new ValidationError("passengerSeats must be a positive integer.");
    }

    const insertResult = await client.query<EventVehicleRow>(
      `INSERT INTO event_vehicles (
         event_id, vehicle_type, driver_student_id, driver_name, driver_phone,
         passenger_seats, meeting_time, meeting_place, note
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        eventId,
        vehicleType,
        input.driverStudentId ?? null,
        driverName,
        normalizeOptionalText(input.driverPhone),
        input.passengerSeats,
        input.meetingTime ?? null,
        normalizeOptionalText(input.meetingPlace),
        normalizeOptionalText(input.note),
      ],
    );
    const vehicle = { ...insertResult.rows[0], seats_taken: 0 };

    await insertAuditLog(client, {
      action: "event_vehicle_created",
      entityType: "event_vehicle",
      entityId: vehicle.id,
      after: vehicle,
      actorUserId: input.actorUserId ?? null,
    });

    await client.query("COMMIT");
    return vehicle;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function assignParticipantToVehicle(
  participantId: EntityId,
  vehicleId: EntityId,
  actorUserId?: number | string | null,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const vehicleResult = await client.query<{ id: string; passenger_seats: number; event_id: string }>(
      `SELECT id, passenger_seats, event_id FROM event_vehicles WHERE id = $1 FOR UPDATE`,
      [vehicleId],
    );
    const vehicle = vehicleResult.rows[0];
    if (!vehicle) throw new EventVehicleNotFoundError();

    const participantResult = await client.query<{ id: string; event_id: string }>(
      `SELECT id, event_id FROM event_participants WHERE id = $1 FOR UPDATE`,
      [participantId],
    );
    const participant = participantResult.rows[0];
    if (!participant) throw new EventParticipantNotFoundError();
    if (participant.event_id !== vehicle.event_id) {
      throw new ValidationError("Vehicle belongs to a different event.");
    }

    const seatsResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM event_participants
        WHERE vehicle_id = $1 AND id <> $2`,
      [vehicleId, participantId],
    );
    if (Number(seatsResult.rows[0].count) >= vehicle.passenger_seats) {
      throw new VehicleFullError();
    }

    await client.query(
      `UPDATE event_participants SET transport_mode = 'needs_vehicle', vehicle_id = $1 WHERE id = $2`,
      [vehicleId, participantId],
    );

    await insertAuditLog(client, {
      action: "event_participant_vehicle_assigned",
      entityType: "event_participant",
      entityId: String(participantId),
      after: { vehicleId: String(vehicleId) },
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// Öğrenci profili kartı için: bu öğrencinin katıldığı/katılacağı etkinliklerdeki
// borç/ödeme özeti. Ana borç hesabına (v_student_summary) hiç girmez.
export async function listEventBalancesForStudent(studentId: EntityId): Promise<Array<{
  event_id: string;
  event_name: string;
  starts_at: string;
  total_due: string;
  total_paid: string;
}>> {
  const result = await pool.query(
    `SELECT e.id AS event_id, e.name AS event_name, e.starts_at,
            COALESCE(SUM(f.amount_snapshot) FILTER (WHERE f.included), 0)::text AS total_due,
            COALESCE(SUM(f.paid_amount), 0)::text AS total_paid
       FROM event_participants p
       JOIN events e ON e.id = p.event_id AND e.deleted_at IS NULL
       LEFT JOIN event_participant_fees f ON f.participant_id = p.id
      WHERE p.student_id = $1
      GROUP BY e.id, e.name, e.starts_at
      ORDER BY e.starts_at DESC`,
    [studentId],
  );
  return result.rows;
}
