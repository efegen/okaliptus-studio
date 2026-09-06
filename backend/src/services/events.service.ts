// Etkinlik (event) modülü. Etkinlik öncesi tutarlar borç değil, katılımcının
// gelmesi halinde ödeyeceği fiyat bilgisidir. Gerçek tahsilatlar ayrı ledger'da
// tutulur; yalnız ders payları KPI'da ayrı etkinlik geliri olarak gösterilir.

import type { PoolClient } from "pg";
import { randomUUID } from "crypto";

import { pool } from "../db/connection.js";
import { createStudentWithClient } from "./students.service.js";
import {
  CompQuotaExceededError,
  DuplicateParticipantError,
  EventActivityNotFoundError,
  EventActivityNotRevertibleError,
  EventFeeItemNotFoundError,
  EventHasPaymentsError,
  EventNotFoundError,
  EventParticipantHasGuestsError,
  EventParticipantHasPaymentsError,
  EventParticipantNoteForbiddenError,
  EventParticipantNoteNotFoundError,
  EventParticipantNotFoundError,
  EventPaymentNotFoundError,
  EventVehicleNotFoundError,
  EventVehicleHasPassengersError,
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
export type ParticipantRemovalReason =
  | "student_cancelled"
  | "plans_changed"
  | "added_by_mistake"
  | "other";
// Misafiri olan biri doğrudan silinemez (bkz. removeParticipant) — çağıran
// taraf bu iki yoldan birini seçmek ZORUNDA: "unlink" misafirleri bağımsız,
// normal katılımcıya çevirir (bağlantı kopar, kendileri kalır); "remove_guests"
// hepsini host ile birlikte kaldırır (ör. host gelmiyorsa misafiri de gelmez).
export type GuestResolution = "unlink" | "remove_guests";
// Bir ücret kaleminin bedelini KİM karşılıyor — bkz. 0263_event_fee_coverage.sql.
// Yalnız "student" katılımcıdan alınacak tutardır; "none" kişiyi kalemin
// sayımından da çıkarır. Etkinlik günü borç üretimi ayrı/deferred akıştır.
export type FeeCoverage = "student" | "studio" | "comp" | "external" | "none";

const EVENT_STATUSES: EventStatus[] = ["upcoming", "live", "completed", "cancelled"];
const PARTICIPANT_ROLES: ParticipantRole[] = ["regular", "invited", "volunteer"];
const RSVP_STATUSES: RsvpStatus[] = ["coming", "unsure"];
const TRANSPORT_MODES: TransportMode[] = ["needs_vehicle", "self_arranged", "unspecified"];
const ATTENDANCE_STATUSES: AttendanceStatus[] = ["pending", "arrived", "no_show"];
const VEHICLE_TYPES: VehicleType[] = ["student_car", "rental_service"];
const FEE_COVERAGES: FeeCoverage[] = ["student", "studio", "comp", "external", "none"];
const PARTICIPANT_REMOVAL_REASONS: ParticipantRemovalReason[] = [
  "student_cancelled",
  "plans_changed",
  "added_by_mistake",
  "other",
];
const GUEST_RESOLUTIONS: GuestResolution[] = ["unlink", "remove_guests"];

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

export type EventPaymentRow = {
  id: string;
  event_id: string;
  participant_id: string | null;
  student_id: string;
  amount: string;
  source: "cash" | "iban";
  paid_at: string;
  cancelled_at: string | null;
  cancellation_note: string | null;
  created_by_name: string | null;
  cancelled_by_name: string | null;
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
  student_name: string;
  student_nickname: string | null;
  student_phone: string | null;
  guest_of_name: string | null;
  last_contacted_at: string | null;
  contact_note: string | null;
  contact_count: number;
  is_new_student: boolean;
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
  guestOfParticipantId?: EntityId | null;
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

export type UpdateVehicleInput = {
  driverName?: string | null;
  driverPhone?: string | null;
  passengerSeats?: number;
  meetingPlace?: string | null;
  note?: string | null;
};

export type RemoveParticipantInput = {
  reason?: ParticipantRemovalReason;
  note?: string | null;
  guestResolution?: GuestResolution;
};

export type ContactParticipantInput = {
  note?: string | null;
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
      eventId: event.id,
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
  if (result.rows.length === 0) return [];

  // Liste ekranı eskiden her etkinlik için ücret + istatistik olmak üzere iki
  // ayrı sorgu çalıştırıyordu (1 + 2N). Bütün özetleri iki toplu sorguyla al;
  // etkinlik sayısı artsa da toplam sorgu sayısı daima üçte kalsın.
  const eventIds = result.rows.map((event) => event.id);
  const [feeResult, statsResult] = await Promise.all([
    pool.query<EventFeeItemRow>(`${FEE_ITEM_SELECT} WHERE i.event_id = ANY($1::bigint[]) ORDER BY i.event_id, i.sort_order, i.id`, [eventIds]),
    pool.query<{
      event_id: string;
      coming: string;
      unsure: string;
      total: string;
      registered: string;
      guests: string;
      potential_amount: string;
      collected_amount: string;
      studio_covered_amount: string;
    }>(
      `SELECT p.event_id,
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
        WHERE p.event_id = ANY($1::bigint[])
        GROUP BY p.event_id`,
      [eventIds],
    ),
  ]);
  const feesByEvent = new Map<string, EventFeeItemRow[]>();
  for (const fee of feeResult.rows) {
    const fees = feesByEvent.get(fee.event_id) ?? [];
    fees.push(fee);
    feesByEvent.set(fee.event_id, fees);
  }
  const statsByEvent = new Map(statsResult.rows.map((stats) => [stats.event_id, stats]));

  return result.rows.map((event) => summaryFrom(event, feesByEvent.get(event.id) ?? [], statsByEvent.get(event.id)));
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
  return summaryFrom(event, feeItems, statsResult.rows[0]);
}

function summaryFrom(
  event: EventRow,
  feeItems: EventFeeItemRow[],
  stats?: {
    coming: string;
    unsure: string;
    total: string;
    registered: string;
    guests: string;
    potential_amount: string;
    collected_amount: string;
    studio_covered_amount: string;
  },
): EventSummary {
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
  transactionClient?: PoolClient,
): Promise<EventRow> {
  const ownsTransaction = transactionClient === undefined;
  const client = transactionClient ?? await pool.connect();

  try {
    if (ownsTransaction) await client.query("BEGIN");
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
      if (ownsTransaction) await client.query("COMMIT");
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
      eventId: updated.id,
      entityType: "event",
      entityId: updated.id,
      before,
      after: updated,
      actorUserId: actorUserId ?? null,
    });

    if (ownsTransaction) await client.query("COMMIT");
    return updated;
  } catch (error) {
    if (ownsTransaction) await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    if (ownsTransaction) client.release();
  }
}

// Etkinlik ayarları → "Tehlikeli bölge". Soft delete (deleted_at) — kayıt fiziksel
// olarak silinmez, yalnız listelerden/özet sorgulardan düşer (tüm event
// sorguları zaten WHERE deleted_at IS NULL kullanıyor). Tahsil edilmiş ödemesi
// olan bir etkinlik silinemez — para hareketi görünmez olmasın diye. Gerçek
// iade yapıldıktan sonra tahsilat kaydı iptal edilirse silme yeniden mümkündür.
export async function deleteEvent(
  eventId: EntityId,
  actorUserId?: number | string | null,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const before = await lockEvent(client, eventId);

    const paidResult = await client.query<{ paid: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS paid
         FROM event_payments
        WHERE event_id = $1 AND cancelled_at IS NULL`,
      [eventId],
    );
    if (Number(paidResult.rows[0].paid) > 0) {
      throw new EventHasPaymentsError();
    }

    await client.query(`UPDATE events SET deleted_at = now() WHERE id = $1`, [eventId]);

    await insertAuditLog(client, {
      action: "event_deleted",
      eventId: String(eventId),
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
      eventId: feeItem.event_id,
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
    p.transport_mode, p.vehicle_id, p.attendance_status,
    s.full_name AS student_name, s.nickname AS student_nickname, s.phone AS student_phone,
    g.full_name AS guest_of_name,
    last_contact.occurred_at AS last_contacted_at,
    last_contact.note AS contact_note,
    last_contact.contact_count,
    NOT student_history.has_completed_lesson AS is_new_student,
    COALESCE(SUM(f.amount_snapshot) FILTER (WHERE f.included), 0)::text AS total_due,
    COALESCE(SUM(f.paid_amount), 0)::text AS total_paid,
    COALESCE(SUM(f.base_amount_snapshot) FILTER (WHERE f.coverage = 'studio'), 0)::text
      AS total_studio_covered
  FROM event_participants p
  JOIN students s ON s.id = p.student_id
  LEFT JOIN event_participants gp ON gp.id = p.guest_of_participant_id
  LEFT JOIN students g ON g.id = gp.student_id
  LEFT JOIN event_participant_fees f ON f.participant_id = p.id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS contact_count,
      (array_agg(i.occurred_at ORDER BY i.occurred_at DESC, i.id DESC))[1] AS occurred_at,
      (array_agg(i.note ORDER BY i.occurred_at DESC, i.id DESC))[1] AS note
      FROM event_participant_interactions i
     WHERE i.participant_id = p.id AND i.interaction_type = 'called'
  ) last_contact ON true
  LEFT JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1
        FROM lessons l
       WHERE l.student_id = p.student_id
         AND l.status = 'completed'
         AND l.deleted_at IS NULL
    ) AS has_completed_lesson
  ) student_history ON true
`;
const PARTICIPANT_GROUP_BY = `
  GROUP BY p.id, s.full_name, s.nickname, s.phone, g.full_name,
           last_contact.occurred_at, last_contact.note, last_contact.contact_count,
           student_history.has_completed_lesson
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

async function getParticipantByIdWith(queryable: Queryable, participantId: EntityId): Promise<EventParticipantRow> {
  const result = await queryable.query<EventParticipantRow>(
    `${PARTICIPANT_SELECT} WHERE p.id = $1 ${PARTICIPANT_GROUP_BY}`,
    [participantId],
  );
  const participant = result.rows[0];
  if (!participant) throw new EventParticipantNotFoundError();
  return participant;
}

export async function getParticipantById(participantId: EntityId): Promise<EventParticipantRow> {
  return getParticipantByIdWith(pool, participantId);
}

async function listParticipantFeesWith(
  queryable: Queryable,
  participantId: EntityId,
): Promise<EventParticipantFeeRow[]> {
  const result = await queryable.query<EventParticipantFeeRow>(
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
  const result = await client.query<{ id: string; guest_of_participant_id: string | null }>(
    `SELECT id, guest_of_participant_id
       FROM event_participants
      WHERE id = $1 AND event_id = $2
      FOR SHARE`,
    [guestOfParticipantId, eventId],
  );
  if (!result.rows[0]) {
    throw new ValidationError("Misafir yalnızca aynı etkinlikteki bir katılımcıya bağlanabilir.");
  }
  if (result.rows[0].guest_of_participant_id !== null) {
    throw new ValidationError("Bir misafire başka bir misafir bağlanamaz.");
  }
  return String(guestOfParticipantId);
}

async function addExistingParticipantWithClient(
  client: PoolClient,
  eventId: EntityId,
  input: AddExistingParticipantInput,
): Promise<string> {
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
      eventId: String(eventId),
      entityType: "event_participant",
      entityId: participantId,
      after: { eventId: String(eventId), studentId: String(input.studentId), role, rsvpStatus },
      actorUserId: input.actorUserId ?? null,
    });

    return participantId;
}

export async function addExistingParticipant(
  eventId: EntityId,
  input: AddExistingParticipantInput,
): Promise<EventParticipantRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const participantId = await addExistingParticipantWithClient(client, eventId, input);
    const participant = await getParticipantByIdWith(client, participantId);
    await client.query("COMMIT");
    return participant;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// 6c: yeni kişi gerçek bir öğrenci kaydı olarak oluşturulur ve aynı transaction
// içinde etkinliğe eklenir. Kontenjan/ücret/misafir doğrulaması başarısız olursa
// öğrenci kaydı da rollback olur; listede sahipsiz kayıt kalmaz.
export async function addNewParticipant(
  eventId: EntityId,
  input: AddNewParticipantInput,
): Promise<EventParticipantRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const student = await createStudentWithClient(client, {
      fullName: input.fullName,
      phone: input.phone ?? null,
      actorUserId: input.actorUserId ?? null,
    });
    const participantId = await addExistingParticipantWithClient(client, eventId, {
      studentId: student.id,
      role: input.role,
      rsvpStatus: input.rsvpStatus,
      guestOfParticipantId: input.guestOfParticipantId,
      transportMode: input.transportMode,
      fees: input.fees,
      actorUserId: input.actorUserId,
    });
    const participant = await getParticipantByIdWith(client, participantId);
    await client.query("COMMIT");
    return participant;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

type ParticipantUpdateSnapshotRow = {
  role: ParticipantRole;
  rsvp_status: RsvpStatus;
  transport_mode: TransportMode;
  attendance_status: AttendanceStatus;
  vehicle_id: string | null;
  guest_of_participant_id: string | null;
};

// "Önce" anlık görüntüsü, input ile AYNI biçimde (camelCase) ve yalnız input'ta
// gerçekten gönderilen alanlar için yazılır — geri alma (revertEventActivity)
// böylece aynı sözlüğü doğrudan updateParticipant'a geri verebilir, dokunulmamış
// alanları yanlışlıkla değiştirmez.
function participantUpdateSnapshot(
  row: ParticipantUpdateSnapshotRow,
  input: UpdateParticipantInput,
): Record<string, unknown> {
  const before: Record<string, unknown> = {};
  if (input.role !== undefined) before.role = row.role;
  if (input.rsvpStatus !== undefined) before.rsvpStatus = row.rsvp_status;
  if (input.transportMode !== undefined) {
    before.transportMode = row.transport_mode;
    // transportMode yazımı vehicle_id'yi daima temizler (bkz. aşağıdaki UPDATE);
    // geri alma eski aracı da bağlayabilsin diye burada saklanır.
    before.vehicleId = row.vehicle_id;
  }
  if (input.attendanceStatus !== undefined) before.attendanceStatus = row.attendance_status;
  if (input.guestOfParticipantId !== undefined) before.guestOfParticipantId = row.guest_of_participant_id;
  return before;
}

export async function updateParticipant(
  participantId: EntityId,
  input: UpdateParticipantInput,
  actorUserId?: number | string | null,
  transactionClient?: PoolClient,
): Promise<EventParticipantRow> {
  const ownsTransaction = transactionClient === undefined;
  const client = transactionClient ?? await pool.connect();

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const eventLookup = await client.query<{ event_id: string }>(
      `SELECT event_id FROM event_participants WHERE id = $1`,
      [participantId],
    );
    if (!eventLookup.rows[0]) throw new EventParticipantNotFoundError();
    await lockEvent(client, eventLookup.rows[0].event_id);

    // "Hareketler" ekranındaki geri alma, değişen alanları eski değerine
    // döndürebilmek için tam satırı ister (bkz. participantUpdateSnapshot).
    const currentResult = await client.query<ParticipantUpdateSnapshotRow & { id: string; event_id: string }>(
      `SELECT id, event_id, role, rsvp_status, transport_mode, attendance_status, vehicle_id, guest_of_participant_id
         FROM event_participants WHERE id = $1 FOR UPDATE`,
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
      // Kategori seçimi açık bir yeniden sınıflandırmadır. Araç atama yalnız
      // ayrı endpoint'ten yapılır; burada önceki araç bağını daima temizle.
      sets.push(`vehicle_id = NULL`);
    }
    if (input.attendanceStatus !== undefined) {
      values.push(normalizeEnum(input.attendanceStatus, ATTENDANCE_STATUSES, "attendanceStatus"));
      sets.push(`attendance_status = $${values.length}`);
    }
    if (input.guestOfParticipantId !== undefined) {
      if (input.guestOfParticipantId == null || input.guestOfParticipantId === "") {
        values.push(null);
        sets.push(`guest_of_participant_id = $${values.length}`);
      } else {
        if (String(input.guestOfParticipantId) === String(participantId)) {
          throw new ValidationError("Bir katılımcı kendi kendisinin misafiri olamaz.");
        }
        if (
          current.guest_of_participant_id !== null
          && String(current.guest_of_participant_id) !== String(input.guestOfParticipantId)
        ) {
          throw new ValidationError("Zaten başka bir katılımcının misafiri olan biri yeniden bağlanamaz.");
        }
        const ownGuests = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM event_participants WHERE guest_of_participant_id = $1`,
          [participantId],
        );
        if (Number(ownGuests.rows[0].count) > 0) {
          throw new ValidationError("Kendi misafiri olan biri başka birinin misafiri olamaz.");
        }
        const guestOfParticipantId = await assertGuestOfValid(client, current.event_id, input.guestOfParticipantId);
        values.push(guestOfParticipantId);
        sets.push(`guest_of_participant_id = $${values.length}`);
      }
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
      eventId: current.event_id,
      entityType: "event_participant",
      entityId: String(participantId),
      before: participantUpdateSnapshot(current, input),
      after: input,
      actorUserId: actorUserId ?? null,
    });

    const updated = await getParticipantByIdWith(client, participantId);
    if (ownsTransaction) await client.query("COMMIT");
    return updated;
  } catch (error) {
    if (ownsTransaction) await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    if (ownsTransaction) client.release();
  }
}

export async function markParticipantContacted(
  participantId: EntityId,
  input: ContactParticipantInput = {},
  actorUserId?: number | string | null,
): Promise<EventParticipantRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const eventLookup = await client.query<{ event_id: string }>(
      `SELECT event_id FROM event_participants WHERE id = $1`,
      [participantId],
    );
    if (!eventLookup.rows[0]) throw new EventParticipantNotFoundError();
    await lockEvent(client, eventLookup.rows[0].event_id);

    const currentResult = await client.query<{
      id: string;
      event_id: string;
      student_id: string;
    }>(
      `SELECT id, event_id, student_id
         FROM event_participants
        WHERE id = $1
        FOR UPDATE`,
      [participantId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new EventParticipantNotFoundError();

    const note = normalizeOptionalText(input.note);
    if (note && note.length > 500) {
      throw new ValidationError("Arama notu en fazla 500 karakter olabilir.");
    }

    const interaction = await client.query<{ id: string; occurred_at: string }>(
      `INSERT INTO event_participant_interactions (
         event_id, participant_id, student_id, interaction_type, note, created_by_user_id
       ) VALUES ($1, $2, $3, 'called', $4, $5)
       RETURNING id, occurred_at`,
      [current.event_id, current.id, current.student_id, note, actorUserId ?? null],
    );

    await insertAuditLog(client, {
      action: "event_participant_contacted",
      eventId: current.event_id,
      entityType: "event_participant",
      entityId: current.id,
      // interactionId geri alma içindir: occurred_at JSON'a milisaniye
      // hassasiyetiyle yazıldığından timestamp eşleşmesi güvenilir değil.
      after: {
        eventId: current.event_id,
        studentId: current.student_id,
        note,
        interactionId: interaction.rows[0].id,
        contactedAt: interaction.rows[0].occurred_at,
      },
      actorUserId: actorUserId ?? null,
    });

    const updated = await getParticipantByIdWith(client, participantId);
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// ─── Katılımcı profili not günlüğü (0280) ───────────────────────────────────
// Eskiden event_participants.note tekil, üzerine yazılan bir alandı. Şimdi
// genel Notlar'daki gibi (bkz. notes.service.ts) birden fazla kullanıcının
// eklediği, yazarı görünen bir günlük — ama kapsam bilinçli olarak dar: yanıt/
// bahis/tepki/fotoğraf yok, yalnız ekle + yazarına özel düzenle/sil. Yalnız bu
// katılımcının bu etkinlikteki profilinde görünür, stüdyo geneline sızmaz.

export type EventParticipantNoteRow = {
  id: string;
  source: "participant_note" | "contact_note" | "mention";
  participant_id: string | null;
  author_user_id: string | null;
  author_name: string;
  body: string;
  categories: Array<{ id: string; name: string }>;
  has_image: boolean;
  created_at: string;
  updated_at: string;
};

const PARTICIPANT_NOTE_SELECT = `
  SELECT n.id, 'participant_note'::text AS source, n.participant_id,
         n.author_user_id, u.display_name AS author_name, n.body,
         '[]'::json AS categories, false AS has_image,
         n.created_at, n.updated_at
    FROM event_participant_notes n
    JOIN users u ON u.id = n.author_user_id
`;

export async function listParticipantNotes(participantId: EntityId): Promise<EventParticipantNoteRow[]> {
  const result = await pool.query<EventParticipantNoteRow>(
    `WITH target AS (
       SELECT id AS participant_id, student_id
         FROM event_participants
        WHERE id = $1
     ), feed AS (
       SELECT n.id::text AS id, 'participant_note'::text AS source,
              n.participant_id::text AS participant_id,
              n.author_user_id::text AS author_user_id,
              u.display_name AS author_name, n.body,
              '[]'::json AS categories, false AS has_image,
              n.created_at, n.updated_at
         FROM event_participant_notes n
         JOIN target t ON t.participant_id = n.participant_id
         JOIN users u ON u.id = n.author_user_id

       UNION ALL

       SELECT i.id::text AS id, 'contact_note'::text AS source,
              i.participant_id::text AS participant_id,
              i.created_by_user_id::text AS author_user_id,
              COALESCE(u.display_name, 'Sistem') AS author_name,
              COALESCE(i.note, 'Arandı olarak işaretlendi.') AS body,
              '[]'::json AS categories, false AS has_image,
              i.occurred_at AS created_at, i.occurred_at AS updated_at
         FROM event_participant_interactions i
         JOIN target t ON t.participant_id = i.participant_id
         LEFT JOIN users u ON u.id = i.created_by_user_id
        WHERE i.interaction_type = 'called'

       UNION ALL

       SELECT n.id::text AS id, 'mention'::text AS source,
              NULL::text AS participant_id,
              n.author_user_id::text AS author_user_id,
              u.display_name AS author_name,
              COALESCE(NULLIF(n.body, ''),
                CASE WHEN ni.note_id IS NOT NULL THEN 'Fotoğraflı not' ELSE 'Öğrenci etiketlendi.' END
              ) AS body,
              CASE WHEN c.id IS NOT NULL
                THEN json_build_array(json_build_object('id', c.id::text, 'name', c.name))
                ELSE '[]'::json
              END AS categories,
              (ni.note_id IS NOT NULL) AS has_image,
              n.created_at, n.updated_at
         FROM notes n
         JOIN note_mentions mention ON mention.note_id = n.id
         JOIN target t ON t.student_id = mention.student_id
         JOIN users u ON u.id = n.author_user_id
         LEFT JOIN note_images ni ON ni.note_id = n.id
         LEFT JOIN note_categories c ON c.id = n.category_id
        WHERE n.deleted_at IS NULL
     )
     SELECT * FROM feed
      ORDER BY created_at DESC, source, id DESC`,
    [participantId],
  );
  return result.rows;
}

export async function listParticipantFees(participantId: EntityId): Promise<EventParticipantFeeRow[]> {
  return listParticipantFeesWith(pool, participantId);
}

export async function addParticipantNote(
  participantId: EntityId,
  bodyInput: string,
  actorUserId: number | string,
): Promise<EventParticipantNoteRow> {
  const body = normalizeRequiredText(bodyInput, "body");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const eventLookup = await client.query<{ event_id: string }>(
      `SELECT event_id FROM event_participants WHERE id = $1`,
      [participantId],
    );
    if (!eventLookup.rows[0]) throw new EventParticipantNotFoundError();
    await lockEvent(client, eventLookup.rows[0].event_id);

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO event_participant_notes (participant_id, author_user_id, body)
       VALUES ($1, $2, $3) RETURNING id`,
      [participantId, actorUserId, body],
    );
    const noteId = insertResult.rows[0].id;

    await insertAuditLog(client, {
      action: "event_participant_note_created",
      entityType: "event_participant_note",
      entityId: noteId,
      after: { participantId: String(participantId), body },
      actorUserId,
    });

    await client.query("COMMIT");

    const result = await pool.query<EventParticipantNoteRow>(`${PARTICIPANT_NOTE_SELECT} WHERE n.id = $1`, [noteId]);
    return result.rows[0];
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// Not silinmişse (fiziksel) ya da hiç yoksa "bulunamadı"; yazarı değilse
// "yasak" — bkz. notes.service.ts lockOwnedNote (aynı kural, ayrı tablo).
async function lockOwnedParticipantNote(
  client: PoolClient,
  noteId: EntityId,
  actorUserId: number | string,
): Promise<{ id: string; participant_id: string }> {
  const result = await client.query<{ id: string; author_user_id: string; participant_id: string }>(
    `SELECT id, author_user_id, participant_id FROM event_participant_notes WHERE id = $1 FOR UPDATE`,
    [noteId],
  );
  const note = result.rows[0];
  if (!note) throw new EventParticipantNoteNotFoundError();
  if (String(note.author_user_id) !== String(actorUserId)) throw new EventParticipantNoteForbiddenError();
  return note;
}

export async function updateParticipantNote(
  noteId: EntityId,
  bodyInput: string,
  actorUserId: number | string,
): Promise<EventParticipantNoteRow> {
  const body = normalizeRequiredText(bodyInput, "body");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await lockOwnedParticipantNote(client, noteId, actorUserId);

    await client.query(`UPDATE event_participant_notes SET body = $1 WHERE id = $2`, [body, noteId]);

    await insertAuditLog(client, {
      action: "event_participant_note_updated",
      entityType: "event_participant_note",
      entityId: noteId,
      after: { body },
      actorUserId,
    });

    await client.query("COMMIT");

    const result = await pool.query<EventParticipantNoteRow>(`${PARTICIPANT_NOTE_SELECT} WHERE n.id = $1`, [noteId]);
    return result.rows[0];
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function deleteParticipantNote(noteId: EntityId, actorUserId: number | string): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await lockOwnedParticipantNote(client, noteId, actorUserId);

    await client.query(`DELETE FROM event_participant_notes WHERE id = $1`, [noteId]);

    await insertAuditLog(client, {
      action: "event_participant_note_deleted",
      entityType: "event_participant_note",
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

// RSVP'de "gelmiyor" seçeneği yok — gelmeyecek kişi işaretlenmez, doğrudan
// listeden silinir. Neden/not, silinen katılımcı satırından bağımsız
// etkileşim geçmişine yazılır. Ödemesi tahsil edilmiş bir katılımcı
// silinemez; misafiri olan biri de guestResolution belirtilmeden silinemez
// (bkz. GuestResolution) — UI önce kullanıcıya "bağlantıları kopart" /
// "misafirleri de kaldır" seçimini sorar.
export async function removeParticipant(
  participantId: EntityId,
  input: RemoveParticipantInput = {},
  actorUserId?: number | string | null,
  transactionClient?: PoolClient,
): Promise<void> {
  const ownsTransaction = transactionClient === undefined;
  const client = transactionClient ?? await pool.connect();

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const eventLookup = await client.query<{ event_id: string }>(
      `SELECT event_id FROM event_participants WHERE id = $1`,
      [participantId],
    );
    if (!eventLookup.rows[0]) throw new EventParticipantNotFoundError();
    await lockEvent(client, eventLookup.rows[0].event_id);

    const currentResult = await client.query<{
      id: string;
      event_id: string;
      student_id: string;
      role: ParticipantRole;
      rsvp_status: RsvpStatus;
      guest_of_participant_id: string | null;
      transport_mode: TransportMode;
    }>(
      // guest_of_participant_id / transport_mode yalnız geri alma için okunur:
      // "kaldırma"nın telafisi kişiyi aynı bağlarla geri eklemektir.
      `SELECT id, event_id, student_id, role, rsvp_status, guest_of_participant_id, transport_mode
         FROM event_participants WHERE id = $1 FOR UPDATE`,
      [participantId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new EventParticipantNotFoundError();

    const removalReason = input.reason === undefined
      ? null
      : normalizeEnum(input.reason, PARTICIPANT_REMOVAL_REASONS, "reason");
    const removalNote = normalizeOptionalText(input.note);
    if (removalNote && removalNote.length > 500) {
      throw new ValidationError("Kaldırma notu en fazla 500 karakter olabilir.");
    }

    const guestsResult = await client.query<{
      id: string;
      student_id: string;
      guest_of_participant_id: string | null;
    }>(
      `SELECT id, student_id, guest_of_participant_id
         FROM event_participants WHERE guest_of_participant_id = $1 FOR UPDATE`,
      [participantId],
    );
    const guests = guestsResult.rows;

    if (guests.length > 0) {
      const guestResolution = input.guestResolution === undefined
        ? null
        : normalizeEnum(input.guestResolution, GUEST_RESOLUTIONS, "guestResolution");
      if (!guestResolution) throw new EventParticipantHasGuestsError();

      if (guestResolution === "unlink") {
        // Misafirler kalır, yalnız bağlantı kopar — bundan sonra herkes gibi
        // bağımsız, normal bir katılımcı olurlar.
        for (const guest of guests) {
          await client.query(
            `UPDATE event_participants SET guest_of_participant_id = NULL WHERE id = $1`,
            [guest.id],
          );
          await insertAuditLog(client, {
            action: "event_participant_guest_unlinked",
            eventId: current.event_id,
            entityType: "event_participant",
            entityId: guest.id,
            before: { guestOfParticipantId: guest.guest_of_participant_id },
            after: { guestOfParticipantId: null },
            actorUserId: actorUserId ?? null,
          });
        }
      } else {
        // remove_guests: hepsi ödemesiz olmadıkça hiçbiri silinmez — kısmi bir
        // silme, yarım kalmış/tutarsız bir misafir listesi bırakırdı.
        for (const guest of guests) {
          const guestPaid = await client.query<{ paid_amount: string }>(
            `SELECT paid_amount FROM event_participant_fees WHERE participant_id = $1 FOR UPDATE`,
            [guest.id],
          );
          if (guestPaid.rows.some((row) => Number(row.paid_amount) > 0)) {
            throw new EventParticipantHasPaymentsError(
              "Misafirlerinden birinin tahsilatı var; önce iade edip iptal edin, sonra tekrar deneyin.",
            );
          }
        }
        for (const guest of guests) {
          await client.query(
            `INSERT INTO event_participant_interactions (
               event_id, participant_id, student_id, interaction_type, removal_reason, note, created_by_user_id
             ) VALUES ($1, $2, $3, 'removed', $4, $5, $6)`,
            [current.event_id, guest.id, guest.student_id, removalReason, removalNote, actorUserId ?? null],
          );
          await client.query(`DELETE FROM event_participants WHERE id = $1`, [guest.id]);
          await insertAuditLog(client, {
            action: "event_participant_removed",
            eventId: current.event_id,
            entityType: "event_participant",
            entityId: guest.id,
            before: { ...guest, removalReason, removalNote },
            actorUserId: actorUserId ?? null,
          });
        }
      }
    }

    const paidResult = await client.query<{ paid_amount: string }>(
      `SELECT paid_amount FROM event_participant_fees WHERE participant_id = $1 FOR UPDATE`,
      [participantId],
    );
    if (paidResult.rows.some((row) => Number(row.paid_amount) > 0)) {
      throw new EventParticipantHasPaymentsError();
    }

    await client.query(
      `INSERT INTO event_participant_interactions (
         event_id, participant_id, student_id, interaction_type, removal_reason, note, created_by_user_id
       ) VALUES ($1, $2, $3, 'removed', $4, $5, $6)`,
      [current.event_id, current.id, current.student_id, removalReason, removalNote, actorUserId ?? null],
    );

    await client.query(`DELETE FROM event_participants WHERE id = $1`, [participantId]);

    await insertAuditLog(client, {
      action: "event_participant_removed",
      eventId: current.event_id,
      entityType: "event_participant",
      entityId: String(participantId),
      before: { ...current, removalReason, removalNote },
      actorUserId: actorUserId ?? null,
    });

    if (ownsTransaction) await client.query("COMMIT");
  } catch (error) {
    if (ownsTransaction) await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    if (ownsTransaction) client.release();
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
  transactionClient?: PoolClient,
): Promise<void> {
  const ownsTransaction = transactionClient === undefined;
  const client = transactionClient ?? await pool.connect();

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const eventLookup = await client.query<{ event_id: string }>(
      `SELECT event_id FROM event_fee_items WHERE id = $1`,
      [feeItemId],
    );
    if (!eventLookup.rows[0]) throw new EventFeeItemNotFoundError();
    await lockEvent(client, eventLookup.rows[0].event_id);

    // Ortak kilit sırası: event → fee_item → participant_fee.
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
      eventId: eventLookup.rows[0].event_id,
      entityType: "event_participant_fee",
      entityId: String(participantId),
      before: { feeItemId: String(feeItemId), coverage: fee.coverage, amount: fee.amount_snapshot },
      after: { feeItemId: String(feeItemId), coverage, amount: amountSnapshot },
      actorUserId: actorUserId ?? null,
    });

    if (ownsTransaction) await client.query("COMMIT");
  } catch (error) {
    if (ownsTransaction) await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    if (ownsTransaction) client.release();
  }
}

// Tek tutar girilir, katılımcının ödenmemiş dahil kalemlerine sırayla (etkinlik
// kalem sırası) dağıtılır. Sayaçla birlikte kalıcı tahsilat + dağılım kaydı
// yazılır; aynı idempotencyKey ağ tekrarı halinde ikinci kez para eklemez.
export async function recordParticipantPayment(
  participantId: EntityId,
  amount: MoneyInput,
  actorUserId?: number | string | null,
  source: "cash" | "iban" = "cash",
  idempotencyKey: string = randomUUID(),
): Promise<EventPaymentRow> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const normalizedAmount = normalizeMoneyInput(amount, "amount");
    const normalizedSource = normalizeEnum(source, ["cash", "iban"], "source");
    const normalizedKey = normalizeRequiredText(idempotencyKey, "idempotencyKey");
    if (normalizedKey.length > 200) throw new ValidationError("idempotencyKey en fazla 200 karakter olabilir.");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`event_payment_${normalizedKey}`]);

    const priorResult = await client.query<EventPaymentRow>(
      `SELECT ep.*, cu.display_name AS created_by_name, xu.display_name AS cancelled_by_name
         FROM event_payments ep
         LEFT JOIN users cu ON cu.id = ep.created_by_user_id
         LEFT JOIN users xu ON xu.id = ep.cancelled_by_user_id
        WHERE ep.idempotency_key = $1`,
      [normalizedKey],
    );
    const prior = priorResult.rows[0];
    if (prior) {
      if (prior.participant_id !== String(participantId)
          || prior.amount !== normalizedAmount || prior.source !== normalizedSource) {
        throw new ValidationError("Bu işlem anahtarı farklı bir tahsilatta kullanılmış.");
      }
      await client.query("COMMIT");
      return prior;
    }

    const eventLookup = await client.query<{ event_id: string }>(
      `SELECT event_id FROM event_participants WHERE id = $1`,
      [participantId],
    );
    if (!eventLookup.rows[0]) throw new EventParticipantNotFoundError();
    await lockEvent(client, eventLookup.rows[0].event_id);

    const participantResult = await client.query<{ id: string; event_id: string; student_id: string }>(
      `SELECT id, event_id, student_id FROM event_participants WHERE id = $1 FOR UPDATE`,
      [participantId],
    );
    const participant = participantResult.rows[0];
    if (!participant) throw new EventParticipantNotFoundError();

    const feeRows = await client.query<{
      id: string;
      fee_item_id: string;
      amount_snapshot: string;
      paid_amount: string;
      label: string;
      is_pass_through: boolean;
      is_lesson_fee: boolean;
    }>(
      `SELECT f.id, f.fee_item_id, f.amount_snapshot, f.paid_amount,
              i.label, i.is_pass_through, i.is_lesson_fee
         FROM event_participant_fees f
         JOIN event_fee_items i ON i.id = f.fee_item_id
        WHERE f.participant_id = $1 AND f.included = true AND f.paid_amount < f.amount_snapshot
        ORDER BY i.sort_order ASC, i.id ASC
        FOR UPDATE`,
      [participantId],
    );

    let remainingCents = moneyToCents(normalizedAmount, "amount");
    const totalOpenCents = feeRows.rows.reduce(
      (sum, row) => sum + (moneyToCents(row.amount_snapshot) - moneyToCents(row.paid_amount)),
      0n,
    );
    if (remainingCents > totalOpenCents) {
      throw new OverpaymentNotAllowedError();
    }

    const paymentResult = await client.query<EventPaymentRow>(
      `INSERT INTO event_payments (
         event_id, participant_id, student_id, amount, source, idempotency_key, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [participant.event_id, participant.id, participant.student_id, normalizedAmount,
        normalizedSource, normalizedKey, actorUserId ?? null],
    );
    const payment = paymentResult.rows[0];

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
      await client.query(
        `INSERT INTO event_payment_allocations (
           payment_id, participant_fee_id, fee_item_id, label_snapshot,
           is_pass_through, is_lesson_fee, amount
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [payment.id, row.id, row.fee_item_id, row.label, row.is_pass_through,
          row.is_lesson_fee, (Number(applyCents) / 100).toFixed(2)],
      );
    }

    await insertAuditLog(client, {
      action: "event_participant_payment_recorded",
      eventId: participant.event_id,
      entityType: "event_payment",
      entityId: payment.id,
      after: { participantId: String(participantId), amount: normalizedAmount, source: normalizedSource },
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
    return { ...payment, created_by_name: null, cancelled_by_name: null };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function listParticipantPayments(participantId: EntityId): Promise<EventPaymentRow[]> {
  const result = await pool.query<EventPaymentRow>(
    `SELECT ep.*, cu.display_name AS created_by_name, xu.display_name AS cancelled_by_name
       FROM event_payments ep
       LEFT JOIN users cu ON cu.id = ep.created_by_user_id
       LEFT JOIN users xu ON xu.id = ep.cancelled_by_user_id
      WHERE ep.participant_id = $1
      ORDER BY ep.paid_at DESC, ep.id DESC`,
    [participantId],
  );
  return result.rows;
}

export async function cancelParticipantPayment(
  paymentId: EntityId,
  note: string | null | undefined,
  actorUserId: EntityId,
  transactionClient?: PoolClient,
): Promise<EventPaymentRow> {
  const ownsTransaction = transactionClient === undefined;
  const client = transactionClient ?? await pool.connect();
  try {
    if (ownsTransaction) await client.query("BEGIN");
    const lookup = await client.query<{ event_id: string }>(
      `SELECT event_id FROM event_payments WHERE id = $1`,
      [paymentId],
    );
    if (!lookup.rows[0]) throw new EventPaymentNotFoundError();
    await lockEvent(client, lookup.rows[0].event_id);

    const paymentResult = await client.query<EventPaymentRow>(
      `SELECT ep.*, cu.display_name AS created_by_name, xu.display_name AS cancelled_by_name
         FROM event_payments ep
         LEFT JOIN users cu ON cu.id = ep.created_by_user_id
         LEFT JOIN users xu ON xu.id = ep.cancelled_by_user_id
        WHERE ep.id = $1
        FOR UPDATE OF ep`,
      [paymentId],
    );
    const payment = paymentResult.rows[0];
    if (!payment) throw new EventPaymentNotFoundError();
    if (payment.cancelled_at !== null) {
      if (ownsTransaction) await client.query("COMMIT");
      return payment;
    }

    const allocations = await client.query<{ participant_fee_id: string | null; amount: string }>(
      `SELECT participant_fee_id, amount
         FROM event_payment_allocations
        WHERE payment_id = $1
        ORDER BY id
        FOR UPDATE`,
      [paymentId],
    );
    for (const allocation of allocations.rows) {
      if (allocation.participant_fee_id == null) {
        throw new ValidationError("Tahsilatın bağlı ücret satırı bulunamadı; işlem iptal edilemedi.");
      }
      const updated = await client.query(
        `UPDATE event_participant_fees
            SET paid_amount = paid_amount - $1
          WHERE id = $2 AND paid_amount >= $1
          RETURNING id`,
        [allocation.amount, allocation.participant_fee_id],
      );
      if (!updated.rows[0]) {
        throw new ValidationError("Tahsilat bakiyesi değişmiş; işlem güvenle iptal edilemedi.");
      }
    }

    const cancellationNote = normalizeRequiredText(note ?? "", "İptal nedeni");
    const cancelledResult = await client.query<EventPaymentRow>(
      `UPDATE event_payments
          SET cancelled_at = now(), cancellation_note = $2, cancelled_by_user_id = $3
        WHERE id = $1
        RETURNING *`,
      [paymentId, cancellationNote, actorUserId],
    );
    const cancelled = cancelledResult.rows[0];
    await insertAuditLog(client, {
      action: "event_participant_payment_cancelled",
      eventId: payment.event_id,
      entityType: "event_payment",
      entityId: cancelled.id,
      before: payment,
      after: cancelled,
      note: cancellationNote,
      actorUserId,
    });
    if (ownsTransaction) await client.query("COMMIT");
    return { ...cancelled, created_by_name: payment.created_by_name, cancelled_by_name: null };
  } catch (error) {
    if (ownsTransaction) await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    if (ownsTransaction) client.release();
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
  transactionClient?: PoolClient,
): Promise<EventVehicleRow> {
  const ownsTransaction = transactionClient === undefined;
  const client = transactionClient ?? await pool.connect();

  try {
    if (ownsTransaction) await client.query("BEGIN");
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
      eventId: vehicle.event_id,
      entityType: "event_vehicle",
      entityId: vehicle.id,
      after: vehicle,
      actorUserId: input.actorUserId ?? null,
    });

    if (ownsTransaction) await client.query("COMMIT");
    return vehicle;
  } catch (error) {
    if (ownsTransaction) await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    if (ownsTransaction) client.release();
  }
}

export async function updateVehicle(
  vehicleId: EntityId,
  input: UpdateVehicleInput,
  actorUserId?: EntityId | null,
  transactionClient?: PoolClient,
): Promise<EventVehicleRow> {
  const ownsTransaction = transactionClient === undefined;
  const client = transactionClient ?? await pool.connect();
  try {
    if (ownsTransaction) await client.query("BEGIN");
    const eventLookup = await client.query<{ event_id: string }>(
      `SELECT event_id FROM event_vehicles WHERE id = $1`,
      [vehicleId],
    );
    if (!eventLookup.rows[0]) throw new EventVehicleNotFoundError();
    await lockEvent(client, eventLookup.rows[0].event_id);

    const vehicleResult = await client.query<EventVehicleRow>(
      `SELECT v.*, COALESCE(r.seats_taken, 0)::int AS seats_taken
         FROM event_vehicles v
         LEFT JOIN (
           SELECT vehicle_id, COUNT(*) AS seats_taken FROM event_participants
            WHERE vehicle_id = $1 GROUP BY vehicle_id
         ) r ON r.vehicle_id = v.id
        WHERE v.id = $1
        FOR UPDATE OF v`,
      [vehicleId],
    );
    const before = vehicleResult.rows[0];
    if (!before) throw new EventVehicleNotFoundError();

    const sets: string[] = [];
    const values: unknown[] = [];
    if (input.driverName !== undefined) {
      const driverName = normalizeOptionalText(input.driverName);
      if (before.driver_student_id == null && driverName == null) {
        throw new ValidationError("Şoför adı boş bırakılamaz.");
      }
      values.push(driverName);
      sets.push(`driver_name = $${values.length}`);
    }
    if (input.driverPhone !== undefined) {
      values.push(normalizeOptionalText(input.driverPhone));
      sets.push(`driver_phone = $${values.length}`);
    }
    if (input.passengerSeats !== undefined) {
      if (!Number.isInteger(input.passengerSeats) || input.passengerSeats <= 0) {
        throw new ValidationError("Yolcu koltuğu pozitif bir tam sayı olmalıdır.");
      }
      if (input.passengerSeats < before.seats_taken) {
        throw new ValidationError(`Koltuk sayısı mevcut ${before.seats_taken} yolcunun altına düşürülemez.`);
      }
      values.push(input.passengerSeats);
      sets.push(`passenger_seats = $${values.length}`);
    }
    if (input.meetingPlace !== undefined) {
      values.push(normalizeOptionalText(input.meetingPlace));
      sets.push(`meeting_place = $${values.length}`);
    }
    if (input.note !== undefined) {
      values.push(normalizeOptionalText(input.note));
      sets.push(`note = $${values.length}`);
    }
    if (sets.length === 0) {
      if (ownsTransaction) await client.query("COMMIT");
      return before;
    }

    values.push(String(vehicleId));
    const updatedResult = await client.query<EventVehicleRow>(
      `UPDATE event_vehicles SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    const updated = { ...updatedResult.rows[0], seats_taken: before.seats_taken };
    await insertAuditLog(client, {
      action: "event_vehicle_updated",
      eventId: updated.event_id,
      entityType: "event_vehicle",
      entityId: updated.id,
      before,
      after: updated,
      actorUserId: actorUserId ?? null,
    });
    if (ownsTransaction) await client.query("COMMIT");
    return updated;
  } catch (error) {
    if (ownsTransaction) await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    if (ownsTransaction) client.release();
  }
}

export async function deleteVehicle(
  vehicleId: EntityId,
  actorUserId?: EntityId | null,
  transactionClient?: PoolClient,
): Promise<void> {
  const ownsTransaction = transactionClient === undefined;
  const client = transactionClient ?? await pool.connect();
  try {
    if (ownsTransaction) await client.query("BEGIN");
    const eventLookup = await client.query<{ event_id: string }>(
      `SELECT event_id FROM event_vehicles WHERE id = $1`,
      [vehicleId],
    );
    if (!eventLookup.rows[0]) throw new EventVehicleNotFoundError();
    await lockEvent(client, eventLookup.rows[0].event_id);
    const vehicleResult = await client.query<EventVehicleRow>(
      `SELECT v.*, 0::int AS seats_taken FROM event_vehicles v WHERE id = $1 FOR UPDATE`,
      [vehicleId],
    );
    const before = vehicleResult.rows[0];
    if (!before) throw new EventVehicleNotFoundError();
    const passengers = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM event_participants WHERE vehicle_id = $1`,
      [vehicleId],
    );
    if (Number(passengers.rows[0].count) > 0) throw new EventVehicleHasPassengersError();
    await client.query(`DELETE FROM event_vehicles WHERE id = $1`, [vehicleId]);
    await insertAuditLog(client, {
      action: "event_vehicle_deleted",
      eventId: before.event_id,
      entityType: "event_vehicle",
      entityId: String(vehicleId),
      before,
      actorUserId: actorUserId ?? null,
    });
    if (ownsTransaction) await client.query("COMMIT");
  } catch (error) {
    if (ownsTransaction) await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    if (ownsTransaction) client.release();
  }
}

export async function assignParticipantToVehicle(
  participantId: EntityId,
  vehicleId: EntityId,
  actorUserId?: number | string | null,
  transactionClient?: PoolClient,
): Promise<void> {
  const ownsTransaction = transactionClient === undefined;
  const client = transactionClient ?? await pool.connect();

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const vehicleLookup = await client.query<{ event_id: string }>(
      `SELECT event_id FROM event_vehicles WHERE id = $1`,
      [vehicleId],
    );
    if (!vehicleLookup.rows[0]) throw new EventVehicleNotFoundError();
    await lockEvent(client, vehicleLookup.rows[0].event_id);

    const vehicleResult = await client.query<{ id: string; passenger_seats: number; event_id: string }>(
      `SELECT id, passenger_seats, event_id FROM event_vehicles WHERE id = $1 FOR UPDATE`,
      [vehicleId],
    );
    const vehicle = vehicleResult.rows[0];
    if (!vehicle) throw new EventVehicleNotFoundError();

    const participantResult = await client.query<{
      id: string;
      event_id: string;
      vehicle_id: string | null;
      transport_mode: TransportMode;
    }>(
      `SELECT id, event_id, vehicle_id, transport_mode FROM event_participants WHERE id = $1 FOR UPDATE`,
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
      eventId: vehicle.event_id,
      entityType: "event_participant",
      entityId: String(participantId),
      before: { vehicleId: participant.vehicle_id, transportMode: participant.transport_mode },
      after: { vehicleId: String(vehicleId) },
      actorUserId: actorUserId ?? null,
    });

    if (ownsTransaction) await client.query("COMMIT");
  } catch (error) {
    if (ownsTransaction) await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    if (ownsTransaction) client.release();
  }
}

// Öğrenci profili kartı için: bu öğrencinin katıldığı/katılacağı etkinliklerdeki
// ödenecek/tahsil edilen özeti. Etkinlik öncesinde ana borç değildir.
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
       JOIN events e ON e.id = p.event_id AND e.deleted_at IS NULL AND e.status <> 'cancelled'
       LEFT JOIN event_participant_fees f ON f.participant_id = p.id
      WHERE p.student_id = $1
      GROUP BY e.id, e.name, e.starts_at
      ORDER BY e.starts_at DESC`,
    [studentId],
  );
  return result.rows;
}

// ─── Etkinlik hareketleri (0279) ─────────────────────────────────────────────
// Mobil etkinlik detayındaki "Hareketler" kısayolunun kaynağı. Ayrı bir hareket
// tablosu YOK: akış, audit_logs'un bu etkinliğe bağlı satırlarıdır (event_id,
// bkz. 0279_event_activity.sql) — kayıt zaten her servis yazımında düşüyordu,
// tek doğruluk noktası korunur.
//
// Geri alma bir SİLME değildir. Telafi işlemi normal servis yolundan yapılır
// (aynı doğrulamalar, kendi audit kaydı), orijinal satır yalnız "geri alındı"
// damgası alır. Böylece hem hata hem düzeltmesi geçmişte görünür kalır ve aynı
// kayıt ikinci kez geri alınamaz.

export type EventActivityRow = {
  id: string;
  event_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  note: string | null;
  created_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  reverted_at: string | null;
  reverted_by_name: string | null;
  subject_name: string | null;
  subject_nickname: string | null;
  // Kayıt hâlâ listede duran bir katılımcıya işaret ediyorsa onun kimliği —
  // "Düzelt" kısayolu yalnız o zaman anlamlı (kaldırılmış kişi açılamaz).
  participant_id: string | null;
  vehicle_label: string | null;
  revertable: boolean;
  revert_blocked_reason: string | null;
};

type EventActivitySqlRow = Omit<EventActivityRow, "revertable" | "revert_blocked_reason">;

// Telafisi tanımlı hareketler. Buraya eklenen her action için
// applyActivityRevert içinde bir dal olmak ZORUNDA.
const REVERTABLE_ACTIONS = new Set<string>([
  "event_updated",
  "event_participant_added",
  "event_participant_updated",
  "event_participant_contacted",
  "event_participant_removed",
  "event_participant_fee_updated",
  "event_participant_payment_recorded",
  "event_participant_vehicle_assigned",
  "event_vehicle_created",
  "event_vehicle_updated",
  "event_vehicle_deleted",
]);

// Eski değeri olmadan geri alınamayan hareketler. 0279 öncesinde yazılmış
// kayıtlarda `before` boş olabilir; o satırlar dürüstçe "geri alınamaz" olur.
const REVERT_NEEDS_BEFORE = new Set<string>([
  "event_updated",
  "event_participant_updated",
  "event_participant_removed",
  "event_participant_fee_updated",
  "event_participant_vehicle_assigned",
  "event_vehicle_updated",
  "event_vehicle_deleted",
]);

// Tam satır snapshot'ından alan-bazlı geri alma yapan hareketlerde `after`,
// aynı alanın daha sonra tekrar değişip değişmediğini anlamak için zorunludur.
// Bu önkoşul olmadan eski bir hareketi geri almak daha yeni düzenlemeyi
// sessizce ezebilirdi.
const REVERT_NEEDS_AFTER = new Set<string>([
  "event_updated",
  "event_vehicle_updated",
]);

const REVERT_BLOCKED_REASONS: Record<string, string> = {
  event_created:
    "Etkinliğin oluşturulması geri alınamaz; etkinliği tümüyle kaldırmak için Ayarlar → Etkinliği sil.",
  event_deleted:
    "Silme buradan geri alınmaz; etkinlik Ayarlar → Durum bölümünden yeniden açılır.",
  event_fee_item_created:
    "Ücret kalemi eklemesi geri alınamaz — kalem tüm katılımcı satırlarına dağıtılmıştır.",
  event_participant_payment_cancelled:
    "Tahsilat iptali geri alınamaz; para gerçekten alındıysa tahsilatı yeniden kaydedin.",
  event_participant_contact_reverted: "Bu kayıt zaten bir geri alma işlemidir.",
  event_participant_vehicle_unassigned: "Bu kayıt zaten bir geri alma işlemidir.",
};

const ACTIVITY_SELECT = `
  SELECT a.id::text,
         a.event_id::text AS event_id,
         a.action,
         a.entity_type,
         a.entity_id::text,
         a.before,
         a.after,
         a.note,
         a.created_at,
         a.actor_user_id::text,
         actor.display_name AS actor_name,
         a.reverted_at,
         reverter.display_name AS reverted_by_name,
         subject.full_name AS subject_name,
         subject.nickname AS subject_nickname,
         COALESCE(
           (SELECT p.id::text FROM event_participants p
             WHERE a.entity_type IN ('event_participant', 'event_participant_fee')
               AND p.id = a.entity_id),
           (SELECT p2.id::text FROM event_payments ep
              JOIN event_participants p2 ON p2.id = ep.participant_id
             WHERE a.entity_type = 'event_payment' AND ep.id = a.entity_id)
         ) AS participant_id,
         COALESCE(a.after ->> 'driver_name', a.before ->> 'driver_name') AS vehicle_label
    FROM audit_logs a
    LEFT JOIN users actor ON actor.id = a.actor_user_id
    LEFT JOIN users reverter ON reverter.id = a.reverted_by_user_id
    -- Hangi kişiyle ilgili: satır duruyorsa join'den, silinmişse (kaldırılmış
    -- katılımcı) kaydın kendi JSON'undan çözülür.
    LEFT JOIN LATERAL (
      SELECT s.full_name, s.nickname
        FROM students s
       WHERE s.id = COALESCE(
               (SELECT p.student_id FROM event_participants p
                 WHERE a.entity_type IN ('event_participant', 'event_participant_fee')
                   AND p.id = a.entity_id),
               (SELECT ep.student_id FROM event_payments ep
                 WHERE a.entity_type = 'event_payment' AND ep.id = a.entity_id),
               CASE WHEN a.before ->> 'student_id' ~ '^[0-9]+$'
                    THEN (a.before ->> 'student_id')::bigint END,
               CASE WHEN a.after ->> 'studentId' ~ '^[0-9]+$'
                    THEN (a.after ->> 'studentId')::bigint END
             )
    ) subject ON true
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function revertBlockedReason(entry: EventActivitySqlRow): string | null {
  if (entry.reverted_at) return "Bu hareket zaten geri alınmış.";
  const known = REVERT_BLOCKED_REASONS[entry.action];
  if (known) return known;
  if (!REVERTABLE_ACTIONS.has(entry.action)) return "Bu hareket türünün otomatik geri alması yok.";
  if (REVERT_NEEDS_BEFORE.has(entry.action) && !isRecord(entry.before)) {
    return "Bu kayıt önceki değerleri saklanmadan yazılmış; geri alınamıyor.";
  }
  if (REVERT_NEEDS_AFTER.has(entry.action) && !isRecord(entry.after)) {
    return "Bu kayıt sonraki değerleri saklanmadan yazılmış; güvenle geri alınamıyor.";
  }
  // Arama kaydı, silinecek etkileşim satırının kimliğiyle birlikte yazılır;
  // 0279 öncesi kayıtlarda bu kimlik yok.
  if (entry.action === "event_participant_contacted"
      && !(isRecord(entry.after) && entry.after.interactionId != null)) {
    return "Bu arama kaydı eski sürümde yazılmış; geri alınamıyor.";
  }
  return null;
}

function decorateActivity(row: EventActivitySqlRow): EventActivityRow {
  const reason = revertBlockedReason(row);
  return { ...row, revertable: reason === null, revert_blocked_reason: reason };
}

async function assertEventExists(eventId: EntityId): Promise<void> {
  const result = await pool.query(
    `SELECT 1 FROM events WHERE id = $1 AND deleted_at IS NULL`,
    [eventId],
  );
  if (!result.rows[0]) throw new EventNotFoundError();
}

export async function listEventActivity(
  eventId: EntityId,
  limit = 100,
): Promise<EventActivityRow[]> {
  await assertEventExists(eventId);
  const safeLimit = Math.min(Math.max(1, Math.trunc(Number(limit) || 100)), 300);
  const result = await pool.query<EventActivitySqlRow>(
    `${ACTIVITY_SELECT}
      WHERE a.event_id = $1
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $2`,
    [eventId, safeLimit],
  );
  return result.rows.map(decorateActivity);
}

async function loadActivityWith(
  queryable: Queryable,
  eventId: EntityId,
  activityId: EntityId,
): Promise<EventActivitySqlRow> {
  const result = await queryable.query<EventActivitySqlRow>(
    `${ACTIVITY_SELECT} WHERE a.event_id = $1 AND a.id = $2`,
    [eventId, activityId],
  );
  const row = result.rows[0];
  if (!row) throw new EventActivityNotFoundError();
  return row;
}

async function loadActivity(
  eventId: EntityId,
  activityId: EntityId,
): Promise<EventActivitySqlRow> {
  return loadActivityWith(pool, eventId, activityId);
}

async function lockActivity(
  client: PoolClient,
  eventId: EntityId,
  activityId: EntityId,
): Promise<EventActivitySqlRow> {
  // ACTIVITY_SELECT dış join'ler içerdiği için doğrudan FOR UPDATE alamaz.
  // Önce kaynak audit satırını kilitle, sonra aynı transaction/client ile
  // zenginleştirilmiş satırı oku. Eşzamanlı ikinci geri alma burada bekler.
  const locked = await client.query<{ id: string }>(
    `SELECT id::text AS id
       FROM audit_logs
      WHERE event_id = $1 AND id = $2
      FOR UPDATE`,
    [eventId, activityId],
  );
  if (!locked.rows[0]) throw new EventActivityNotFoundError();
  return loadActivityWith(client, eventId, activityId);
}

const REVERT_NOTE = "Hareketler ekranından geri alındı.";

export async function revertEventActivity(
  eventId: EntityId,
  activityId: EntityId,
  actorUserId: EntityId,
): Promise<EventActivityRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const entry = await lockActivity(client, eventId, activityId);
    const blocked = revertBlockedReason(entry);
    if (blocked) throw new EventActivityNotRevertibleError(blocked);

    // Telafi, telafinin normal audit kaydı ve orijinal kaydın damgası aynı
    // transaction'dadır. Çökme/hata hepsini geri alır; FOR UPDATE da iki
    // eşzamanlı isteğin aynı telafiyi uygulamasını engeller.
    await applyActivityRevert(client, entry, eventId, actorUserId);

    const stamped = await client.query(
      `UPDATE audit_logs
          SET reverted_at = now(), reverted_by_user_id = $2
        WHERE id = $1 AND reverted_at IS NULL`,
      [entry.id, actorUserId],
    );
    if (stamped.rowCount !== 1) {
      throw new EventActivityNotRevertibleError("Bu hareket zaten geri alınmış.");
    }

    const result = decorateActivity(await loadActivityWith(client, eventId, activityId));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

function requireBefore(entry: EventActivitySqlRow): Record<string, unknown> {
  if (!isRecord(entry.before)) {
    throw new EventActivityNotRevertibleError(
      "Bu kaydın önceki değeri bulunamadı; geri alınamıyor.",
    );
  }
  return entry.before;
}

function requireAfter(entry: EventActivitySqlRow): Record<string, unknown> {
  if (!isRecord(entry.after)) {
    throw new EventActivityNotRevertibleError(
      "Bu kaydın sonraki değeri bulunamadı; güvenle geri alınamıyor.",
    );
  }
  return entry.after;
}

function activitySnapshotValueEquals(field: string, left: unknown, right: unknown): boolean {
  if (field === "starts_at") {
    const leftTime = left instanceof Date ? left.getTime() : Date.parse(String(left));
    const rightTime = right instanceof Date ? right.getTime() : Date.parse(String(right));
    return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
  }
  return Object.is(left, right);
}

function assertRevertFieldsStillCurrent(
  current: Record<string, unknown>,
  after: Record<string, unknown>,
  changedFields: string[],
): void {
  const staleFields = changedFields.filter(
    (field) => !activitySnapshotValueEquals(field, current[field], after[field]),
  );
  if (staleFields.length > 0) {
    throw new EventActivityNotRevertibleError(
      "Bu hareketten sonra aynı alan yeniden değiştirilmiş; daha yeni düzenlemeyi korumak için geri alma durduruldu.",
    );
  }
}

async function revertEventUpdate(
  client: PoolClient,
  entry: EventActivitySqlRow,
  eventId: EntityId,
  actorUserId: EntityId,
): Promise<void> {
  const before = requireBefore(entry);
  const after = requireAfter(entry);
  const current = await lockEvent(client, eventId) as unknown as Record<string, unknown>;
  const fields = [
    "name",
    "starts_at",
    "location",
    "status",
    "capacity_limit",
    "transport_enabled",
    "note",
  ];
  const changedFields = fields.filter(
    (field) => !activitySnapshotValueEquals(field, before[field], after[field]),
  );
  assertRevertFieldsStillCurrent(current, after, changedFields);

  const input: UpdateEventInput = {};
  for (const field of changedFields) {
    switch (field) {
      case "name": input.name = before.name as string; break;
      case "starts_at": input.startsAt = before.starts_at as string; break;
      case "location": input.location = before.location as string | null; break;
      case "status": input.status = before.status as EventStatus; break;
      case "capacity_limit": input.capacityLimit = before.capacity_limit as number | null; break;
      case "transport_enabled": input.transportEnabled = before.transport_enabled as boolean; break;
      case "note": input.note = before.note as string | null; break;
    }
  }
  await updateEvent(eventId, input, actorUserId, client);
}

async function revertVehicleUpdate(
  client: PoolClient,
  entry: EventActivitySqlRow,
  actorUserId: EntityId,
): Promise<void> {
  const before = requireBefore(entry);
  const after = requireAfter(entry);
  const currentResult = await client.query<Record<string, unknown>>(
    `SELECT * FROM event_vehicles WHERE id = $1 FOR UPDATE`,
    [entry.entity_id],
  );
  const current = currentResult.rows[0];
  if (!current) throw new EventVehicleNotFoundError();
  const fields = ["driver_name", "driver_phone", "passenger_seats", "meeting_place", "note"];
  const changedFields = fields.filter(
    (field) => !activitySnapshotValueEquals(field, before[field], after[field]),
  );
  assertRevertFieldsStillCurrent(current, after, changedFields);

  const input: UpdateVehicleInput = {};
  for (const field of changedFields) {
    switch (field) {
      case "driver_name": input.driverName = before.driver_name as string | null; break;
      case "driver_phone": input.driverPhone = before.driver_phone as string | null; break;
      case "passenger_seats": input.passengerSeats = before.passenger_seats as number; break;
      case "meeting_place": input.meetingPlace = before.meeting_place as string | null; break;
      case "note": input.note = before.note as string | null; break;
    }
  }
  await updateVehicle(entry.entity_id, input, actorUserId, client);
}

async function applyActivityRevert(
  client: PoolClient,
  entry: EventActivitySqlRow,
  eventId: EntityId,
  actorUserId: EntityId,
): Promise<void> {
  switch (entry.action) {
    case "event_updated": {
      await revertEventUpdate(client, entry, eventId, actorUserId);
      return;
    }

    case "event_participant_added": {
      // Telafi = kişiyi listeden kaldırmak. Ödemesi/misafiri varsa servis
      // reddeder — geri alma bu kuralları atlamaz.
      await removeParticipant(
        entry.entity_id,
        { reason: "added_by_mistake", note: REVERT_NOTE },
        actorUserId,
        client,
      );
      return;
    }

    case "event_participant_removed": {
      const before = requireBefore(entry);
      await addExistingParticipantWithClient(client, eventId, {
        studentId: String(before.student_id),
        role: before.role as ParticipantRole | undefined,
        rsvpStatus: before.rsvp_status as RsvpStatus | undefined,
        // Misafirse eski bağ da kurulur; host'u da kaldırılmışsa servis
        // "önce host'u geri ekleyin" anlamına gelen hatayı verir.
        guestOfParticipantId: (before.guest_of_participant_id as string | null) ?? null,
        transportMode: before.transport_mode as TransportMode | undefined,
        actorUserId,
      });
      return;
    }

    case "event_participant_updated": {
      const before = requireBefore(entry);
      const { vehicleId, ...fields } = before;
      if (Object.keys(fields).length > 0) {
        await updateParticipant(entry.entity_id, fields as UpdateParticipantInput, actorUserId, client);
      }
      // transportMode yazımı aracı koparır; eski araç varsa geri bağlanır.
      // Koltuk dolduysa hata görünür olur, sessizce yutulmaz.
      if (fields.transportMode !== undefined && vehicleId != null) {
        await assignParticipantToVehicle(entry.entity_id, String(vehicleId), actorUserId, client);
      }
      return;
    }

    case "event_participant_contacted": {
      await revertContactInteraction(client, entry, actorUserId);
      return;
    }

    case "event_participant_fee_updated": {
      const before = requireBefore(entry);
      const feeItemId = String(before.feeItemId);
      await updateParticipantFee(
        entry.entity_id,
        feeItemId,
        { coverage: before.coverage as FeeCoverage },
        actorUserId,
        client,
      );
      // Kişiye özel ders ücreti (0272) yalnız "öğrenci ödüyor" durumunda ve
      // yalnız ders kaleminde anlamlı; ancak kapsam geri alındıktan SONRA
      // yazılabilir, o yüzden ikinci adım.
      if (before.coverage === "student" && before.amount != null) {
        const fees = await listParticipantFeesWith(client, entry.entity_id);
        const fee = fees.find((row) => String(row.fee_item_id) === feeItemId);
        if (fee?.is_lesson_fee && fee.amount_snapshot !== String(before.amount)) {
          await updateParticipantFee(
            entry.entity_id,
            feeItemId,
            { amount: String(before.amount) },
            actorUserId,
            client,
          );
        }
      }
      return;
    }

    case "event_participant_payment_recorded": {
      // Tahsilat kaydı silinmez, iptal edilir (defter bozulmasın) — sistem dışı
      // nakit iadesi her zaman operatörün sorumluluğundadır.
      await cancelParticipantPayment(entry.entity_id, REVERT_NOTE, actorUserId, client);
      return;
    }

    case "event_participant_vehicle_assigned": {
      const before = requireBefore(entry);
      if (before.vehicleId != null) {
        await assignParticipantToVehicle(entry.entity_id, String(before.vehicleId), actorUserId, client);
        return;
      }
      await unassignParticipantVehicle(
        client,
        entry,
        (before.transportMode as TransportMode | undefined) ?? "unspecified",
        actorUserId,
      );
      return;
    }

    case "event_vehicle_created": {
      await deleteVehicle(entry.entity_id, actorUserId, client);
      return;
    }

    case "event_vehicle_updated": {
      await revertVehicleUpdate(client, entry, actorUserId);
      return;
    }

    case "event_vehicle_deleted": {
      // Araç yeni bir kimlikle geri gelir; silinebilmesi için yolcusuz olması
      // gerekiyordu, dolayısıyla kopan bir yolcu bağı yoktur.
      const before = requireBefore(entry) as unknown as EventVehicleRow;
      await createVehicle(eventId, {
        vehicleType: before.vehicle_type,
        driverStudentId: before.driver_student_id,
        driverName: before.driver_name,
        driverPhone: before.driver_phone,
        passengerSeats: before.passenger_seats,
        meetingTime: before.meeting_time,
        meetingPlace: before.meeting_place,
        note: before.note,
        actorUserId,
      }, client);
      return;
    }

    default:
      throw new EventActivityNotRevertibleError("Bu hareket türünün otomatik geri alması yok.");
  }
}

// "Arandı" kaydının telafisi: etkileşim satırını sil. Doğal bir servis çağrısı
// yok, o yüzden tek transaction + kendi audit kaydı (action 0279'da eklendi).
async function revertContactInteraction(
  transactionClient: PoolClient,
  entry: EventActivitySqlRow,
  actorUserId: EntityId,
): Promise<void> {
  const after = isRecord(entry.after) ? entry.after : {};
  const interactionId = after.interactionId;
  if (interactionId == null) {
    throw new EventActivityNotRevertibleError(
      "Bu arama kaydı eski sürümde yazılmış; geri alınamıyor.",
    );
  }

  const client = transactionClient;
  try {
    const deleted = await client.query<{ id: string }>(
      `DELETE FROM event_participant_interactions
        WHERE id = $1 AND participant_id = $2 AND interaction_type = 'called'
        RETURNING id`,
      [String(interactionId), entry.entity_id],
    );
    if (!deleted.rows[0]) {
      throw new EventActivityNotRevertibleError(
        "Arama kaydı bulunamadı; muhtemelen zaten geri alınmış.",
      );
    }
    await insertAuditLog(client, {
      action: "event_participant_contact_reverted",
      eventId: entry.event_id,
      entityType: "event_participant",
      entityId: entry.entity_id,
      before: entry.after,
      note: REVERT_NOTE,
      actorUserId,
    });
  } catch (error) {
    throw toServiceError(error);
  }
}

// Araç ataması öncesinde kişi hiçbir araca bağlı değildi: aracı çöz, ulaşım
// tercihini eski değerine döndür.
async function unassignParticipantVehicle(
  transactionClient: PoolClient,
  entry: EventActivitySqlRow,
  transportMode: TransportMode,
  actorUserId: EntityId,
): Promise<void> {
  const client = transactionClient;
  try {
    const updated = await client.query<{ id: string; event_id: string }>(
      `UPDATE event_participants SET vehicle_id = NULL, transport_mode = $2
        WHERE id = $1
        RETURNING id, event_id`,
      [entry.entity_id, normalizeEnum(transportMode, TRANSPORT_MODES, "transportMode")],
    );
    if (!updated.rows[0]) throw new EventParticipantNotFoundError();
    await insertAuditLog(client, {
      action: "event_participant_vehicle_unassigned",
      eventId: updated.rows[0].event_id,
      entityType: "event_participant",
      entityId: entry.entity_id,
      before: entry.after,
      after: { vehicleId: null, transportMode },
      note: REVERT_NOTE,
      actorUserId,
    });
  } catch (error) {
    throw toServiceError(error);
  }
}
