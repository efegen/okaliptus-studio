import type { PoolClient } from "pg";

import { pool } from "../db/connection.js";
import {
  CalendarEventConflictError,
  CalendarEventNotFoundError,
  ValidationError,
  toServiceError,
} from "./errors.js";
import {
  insertAuditLog,
  normalizeOptionalText,
  normalizeRequiredText,
  rollbackQuietly,
  type EntityId,
} from "./shared.js";

const VALID_EVENT_TYPES = ["plan"] as const;
const VALID_LABEL_COLORS = ["graphite", "slate", "plum", "teal"] as const;

// Bir plan bilgi amaçlı en fazla bu kadar katılımcı taşıyabilir. Üst sınır
// yalnızca kötü niyetli/hatalı isteklere karşı; pratikte çok altında kalınır.
const MAX_PARTICIPANTS = 50;

type CalendarEventRow = {
  id: string;
  event_type: string;
  title: string;
  starts_at: string;
  duration_minutes: number;
  label_color: string;
  note: string | null;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

// Katılımcı = plana bilgi amaçlı iliştirilmiş öğrenci. Finansal DEĞİL:
// student_id dışında lessons ile hiçbir ilişkisi yoktur.
export type CalendarEventParticipant = {
  id: string;
  full_name: string;
  nickname: string | null;
};

export type CalendarEventWithParticipants = CalendarEventRow & {
  participants: CalendarEventParticipant[];
};

export type CreateCalendarEventInput = {
  eventType: string;
  title: string;
  startsAt: string;
  durationMinutes?: number;
  labelColor?: string;
  note?: string | null;
  participantIds?: unknown;
  actorUserId?: EntityId | null;
};

export type UpdateCalendarEventInput = {
  title?: string;
  durationMinutes?: number;
  labelColor?: string;
  note?: string | null;
  // undefined → katılımcılar değişmez; dizi (boş dahil) → tam liste ile değiştirilir.
  participantIds?: unknown;
  actorUserId?: EntityId | null;
};

// ─── Participant helpers ──────────────────────────────────────────────────────

// Dönüş: undefined → "dokunma" (update için), dizi → temizlenmiş benzersiz id'ler.
function normalizeParticipantIds(raw: unknown): number[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ValidationError("participantIds must be an array of student ids.");
  }
  const ids: number[] = [];
  for (const entry of raw) {
    const n = Number(entry);
    if (!Number.isInteger(n) || n <= 0) {
      throw new ValidationError("participantIds must contain positive integer student ids.");
    }
    ids.push(n);
  }
  const unique = Array.from(new Set(ids));
  if (unique.length > MAX_PARTICIPANTS) {
    throw new ValidationError(`En fazla ${MAX_PARTICIPANTS} katılımcı seçilebilir.`);
  }
  return unique;
}

// Verilen id'lerin tümü var olan (silinmemiş) öğrenci mi? Değilse reddet —
// böylece hayalet/başka tenant id'leri join tablosuna sızmaz.
async function assertStudentsExist(client: PoolClient, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM students
      WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
    [ids],
  );
  if (Number(result.rows[0].count) !== ids.length) {
    throw new ValidationError("Seçilen katılımcılardan bazıları bulunamadı.");
  }
}

async function replaceParticipants(
  client: PoolClient,
  eventId: EntityId,
  ids: number[],
): Promise<void> {
  await client.query(
    `DELETE FROM calendar_event_participants WHERE calendar_event_id = $1`,
    [eventId],
  );
  if (ids.length > 0) {
    await client.query(
      `INSERT INTO calendar_event_participants (calendar_event_id, student_id)
       SELECT $1, unnest($2::bigint[])`,
      [eventId, ids],
    );
  }
}

async function fetchParticipants(
  client: PoolClient,
  eventId: EntityId,
): Promise<CalendarEventParticipant[]> {
  const result = await client.query<CalendarEventParticipant>(
    `SELECT s.id, s.full_name, s.nickname
       FROM calendar_event_participants cep
       JOIN students s ON s.id = cep.student_id AND s.deleted_at IS NULL
      WHERE cep.calendar_event_id = $1
      ORDER BY lower(s.full_name), s.id`,
    [eventId],
  );
  return result.rows;
}

// lessons.service.createLesson bir ders eklerken bu saatte bir plan olup
// olmadığını sormak için kullanır (plan ↔ ders çakışması karşılıklıdır).
export async function assertNoConflictingCalendarEvent(
  client: PoolClient,
  startsAt: string,
  durationMinutes: number,
): Promise<void> {
  const result = await client.query<{ conflict: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1 FROM calendar_events
        WHERE deleted_at IS NULL
          AND starts_at < $1::timestamptz + ($2 * INTERVAL '1 minute')
          AND (starts_at + duration_minutes * INTERVAL '1 minute') > $1::timestamptz
      ) AS conflict
    `,
    [startsAt, durationMinutes],
  );
  if (result.rows[0].conflict) {
    throw new CalendarEventConflictError("Bu saatte planlanmış bir plan var.");
  }
}

// Planlar birbiriyle VE derslerle çakışamaz (tek eğitmenli stüdyo — zaman
// bloğu global'dir, eğitmen bazlı değil). Plan oluşturma/düzenlemede kullanılır.
async function assertNoScheduleConflict(
  client: PoolClient,
  startsAt: string,
  durationMinutes: number,
  excludeEventId: EntityId | null,
): Promise<void> {
  const conflictResult = await client.query<{
    event_conflict: boolean;
    lesson_conflict: boolean;
  }>(
    `
      SELECT
        EXISTS (
          SELECT 1 FROM calendar_events
          WHERE deleted_at IS NULL
            AND ($3::bigint IS NULL OR id <> $3::bigint)
            AND starts_at < $1::timestamptz + ($2 * INTERVAL '1 minute')
            AND (starts_at + duration_minutes * INTERVAL '1 minute') > $1::timestamptz
        ) AS event_conflict,
        EXISTS (
          SELECT 1 FROM lessons
          WHERE deleted_at IS NULL
            AND status NOT IN ('cancelled', 'no_show')
            AND starts_at < $1::timestamptz + ($2 * INTERVAL '1 minute')
            AND (starts_at + duration_minutes * INTERVAL '1 minute') > $1::timestamptz
        ) AS lesson_conflict
    `,
    [startsAt, durationMinutes, excludeEventId],
  );

  const { event_conflict, lesson_conflict } = conflictResult.rows[0];
  if (event_conflict) {
    throw new CalendarEventConflictError("Bu saatte başka bir plan var.");
  }
  if (lesson_conflict) {
    throw new CalendarEventConflictError("Bu saatte planlanmış bir ders var.");
  }
}

export async function createCalendarEvent(
  input: CreateCalendarEventInput,
): Promise<CalendarEventWithParticipants> {
  const title = normalizeRequiredText(input.title, "title");
  const eventType = input.eventType;
  if (!VALID_EVENT_TYPES.includes(eventType as (typeof VALID_EVENT_TYPES)[number])) {
    throw new ValidationError(`event_type must be one of: ${VALID_EVENT_TYPES.join(", ")}`);
  }

  const startsAt = input.startsAt;
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) {
    throw new ValidationError("startsAt must be a valid ISO date.");
  }

  const durationMinutes = input.durationMinutes ?? 60;
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new ValidationError("durationMinutes must be a positive integer.");
  }

  const labelColor = input.labelColor ?? "graphite";
  if (!VALID_LABEL_COLORS.includes(labelColor as (typeof VALID_LABEL_COLORS)[number])) {
    throw new ValidationError(`label_color must be one of: ${VALID_LABEL_COLORS.join(", ")}`);
  }

  const note = normalizeOptionalText(input.note as string | null | undefined);

  // Create'te undefined → katılımcı yok (boş liste).
  const participantIds = normalizeParticipantIds(input.participantIds) ?? [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await assertNoScheduleConflict(client, startsAt, durationMinutes, null);
    await assertStudentsExist(client, participantIds);

    const result = await client.query<CalendarEventRow>(
      `INSERT INTO calendar_events
         (event_type, title, starts_at, duration_minutes, label_color, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [eventType, title, startsAt, durationMinutes, labelColor, note, input.actorUserId ?? null],
    );

    const row = result.rows[0];

    await replaceParticipants(client, row.id, participantIds);
    const participants = await fetchParticipants(client, row.id);
    const withParticipants: CalendarEventWithParticipants = { ...row, participants };

    await insertAuditLog(client, {
      action: "calendar_event_created",
      entityType: "calendar_event",
      entityId: row.id,
      after: withParticipants,
      actorUserId: input.actorUserId,
    });

    await client.query("COMMIT");
    return withParticipants;
  } catch (err) {
    await rollbackQuietly(client);
    throw toServiceError(err);
  } finally {
    client.release();
  }
}

// startsAt kasıtlı olarak düzenlenemez: takvimde zaman değişikliği için hücre
// seçimine dayalı bir akış yok (v1 dışı, bkz. lesson yeniden zamanlama).
export async function updateCalendarEvent(
  eventId: EntityId,
  input: UpdateCalendarEventInput,
): Promise<CalendarEventWithParticipants> {
  // undefined → katılımcılara dokunma; dizi → tam liste ile değiştir.
  const nextParticipantIds = normalizeParticipantIds(input.participantIds);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeResult = await client.query<CalendarEventRow>(
      `SELECT * FROM calendar_events WHERE id = $1 AND deleted_at IS NULL`,
      [eventId],
    );
    const before = beforeResult.rows[0];
    if (!before) throw new CalendarEventNotFoundError();

    const beforeParticipants = await fetchParticipants(client, eventId);

    const title =
      input.title !== undefined ? normalizeRequiredText(input.title, "title") : before.title;

    const durationMinutes = input.durationMinutes ?? before.duration_minutes;
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      throw new ValidationError("durationMinutes must be a positive integer.");
    }

    const labelColor = input.labelColor ?? before.label_color;
    if (!VALID_LABEL_COLORS.includes(labelColor as (typeof VALID_LABEL_COLORS)[number])) {
      throw new ValidationError(`label_color must be one of: ${VALID_LABEL_COLORS.join(", ")}`);
    }

    const note =
      input.note !== undefined ? normalizeOptionalText(input.note) : before.note;

    await assertNoScheduleConflict(client, before.starts_at, durationMinutes, eventId);

    if (nextParticipantIds !== undefined) {
      await assertStudentsExist(client, nextParticipantIds);
      await replaceParticipants(client, eventId, nextParticipantIds);
    }

    const result = await client.query<CalendarEventRow>(
      `UPDATE calendar_events
       SET title = $1, duration_minutes = $2, label_color = $3, note = $4, updated_at = now()
       WHERE id = $5
       RETURNING *`,
      [title, durationMinutes, labelColor, note, eventId],
    );

    const row = result.rows[0];
    const participants = await fetchParticipants(client, eventId);
    const withParticipants: CalendarEventWithParticipants = { ...row, participants };

    await insertAuditLog(client, {
      action: "calendar_event_updated",
      entityType: "calendar_event",
      entityId: row.id,
      before: { ...before, participants: beforeParticipants },
      after: withParticipants,
      actorUserId: input.actorUserId ?? null,
    });

    await client.query("COMMIT");
    return withParticipants;
  } catch (err) {
    await rollbackQuietly(client);
    throw toServiceError(err);
  } finally {
    client.release();
  }
}

export async function listCalendarEventsInRange(
  fromIso: string,
  toIso: string,
): Promise<CalendarEventWithParticipants[]> {
  if (!fromIso || !toIso) {
    throw new ValidationError("from and to query params are required.");
  }
  if (Number.isNaN(Date.parse(fromIso)) || Number.isNaN(Date.parse(toIso))) {
    throw new ValidationError("from and to must be valid ISO dates.");
  }

  // Katılımcılar tek sorguda jsonb dizisi olarak toplanır (N+1 yok). Silinmiş
  // öğrenciler dışarıda; katılımcısız planlar boş dizi döner.
  const result = await pool.query<CalendarEventWithParticipants>(
    `SELECT ce.*,
       COALESCE((
         SELECT jsonb_agg(
                  jsonb_build_object('id', s.id, 'full_name', s.full_name, 'nickname', s.nickname)
                  ORDER BY lower(s.full_name), s.id
                )
           FROM calendar_event_participants cep
           JOIN students s ON s.id = cep.student_id AND s.deleted_at IS NULL
          WHERE cep.calendar_event_id = ce.id
       ), '[]'::jsonb) AS participants
     FROM calendar_events ce
     WHERE ce.starts_at >= $1 AND ce.starts_at < $2 AND ce.deleted_at IS NULL
     ORDER BY ce.starts_at ASC, ce.id ASC`,
    [fromIso, toIso],
  );
  return result.rows;
}

export async function deleteCalendarEvent(
  eventId: EntityId,
  actorUserId?: EntityId | null,
): Promise<CalendarEventRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query<CalendarEventRow>(
      `UPDATE calendar_events SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [eventId],
    );

    const row = result.rows[0];
    if (!row) throw new CalendarEventNotFoundError();

    await insertAuditLog(client, {
      action: "calendar_event_deleted",
      entityType: "calendar_event",
      entityId: row.id,
      before: row,
      actorUserId: actorUserId ?? null,
    });

    await client.query("COMMIT");
    return row;
  } catch (err) {
    await rollbackQuietly(client);
    throw toServiceError(err);
  } finally {
    client.release();
  }
}
