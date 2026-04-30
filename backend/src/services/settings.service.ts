import { pool } from "../db/connection.js";
import { ValidationError, toServiceError } from "./errors.js";
import { insertAuditLog, rollbackQuietly } from "./shared.js";

export type StudioSettings = {
  weeklyCapacity: number;
  weekStart: string;
  calendarStartHour: number;
  calendarEndHour: number;
  defaultLessonDuration: number;
  defaultLessonMode: "online" | "onsite";
  defaultCurrency: string;
  paymentMethodCash: boolean;
  paymentMethodIban: boolean;
  lessonColorSaturation: number;
};

function rowToSettings(row: Record<string, unknown>): StudioSettings {
  return {
    weeklyCapacity: Number(row.weekly_capacity),
    weekStart: row.week_start as string,
    calendarStartHour: Number(row.calendar_start_hour),
    calendarEndHour: Number(row.calendar_end_hour),
    defaultLessonDuration: Number(row.default_lesson_duration),
    defaultLessonMode: row.default_lesson_mode as "online" | "onsite",
    defaultCurrency: row.default_currency as string,
    paymentMethodCash: Boolean(row.payment_method_cash),
    paymentMethodIban: Boolean(row.payment_method_iban),
    lessonColorSaturation: Number(row.lesson_color_saturation ?? 1),
  };
}

export async function getSettings(): Promise<StudioSettings> {
  const result = await pool.query(`
    SELECT
      weekly_capacity, week_start,
      calendar_start_hour, calendar_end_hour,
      default_lesson_duration, default_lesson_mode,
      default_currency, payment_method_cash, payment_method_iban,
      lesson_color_saturation
    FROM studio_settings WHERE id = 1
  `);

  if (!result.rows[0]) {
    throw new Error("studio_settings satırı bulunamadı.");
  }

  return rowToSettings(result.rows[0]);
}

type SettingsPatch = {
  weeklyCapacity?: number;
  calendarStartHour?: number;
  calendarEndHour?: number;
  defaultLessonDuration?: number;
  defaultLessonMode?: "online" | "onsite";
  paymentMethodCash?: boolean;
  paymentMethodIban?: boolean;
  lessonColorSaturation?: number;
};

export async function updateSettings(patch: SettingsPatch, actorUserId?: number | string | null): Promise<StudioSettings> {
  if (
    patch.weeklyCapacity !== undefined &&
    (!Number.isInteger(patch.weeklyCapacity) || patch.weeklyCapacity <= 0)
  ) {
    throw new ValidationError("Haftalık kapasite pozitif tam sayı olmalı.");
  }

  if (
    patch.calendarStartHour !== undefined &&
    (!Number.isInteger(patch.calendarStartHour) ||
      patch.calendarStartHour < 0 ||
      patch.calendarStartHour >= 24)
  ) {
    throw new ValidationError("Takvim başlangıç saati 0–23 arasında tam sayı olmalı.");
  }

  if (
    patch.calendarEndHour !== undefined &&
    (!Number.isInteger(patch.calendarEndHour) ||
      patch.calendarEndHour <= 0 ||
      patch.calendarEndHour > 24)
  ) {
    throw new ValidationError("Takvim bitiş saati 1–24 arasında tam sayı olmalı.");
  }

  if (patch.calendarStartHour !== undefined || patch.calendarEndHour !== undefined) {
    const current = await getSettings();
    const start = patch.calendarStartHour ?? current.calendarStartHour;
    const end = patch.calendarEndHour ?? current.calendarEndHour;
    if (start >= end) {
      throw new ValidationError(
        "Takvim başlangıç saati bitiş saatinden küçük olmalı."
      );
    }
  }

  if (
    patch.defaultLessonDuration !== undefined &&
    (!Number.isInteger(patch.defaultLessonDuration) ||
      patch.defaultLessonDuration <= 0 ||
      patch.defaultLessonDuration > 240)
  ) {
    throw new ValidationError("Ders süresi 1–240 dakika arasında tam sayı olmalı.");
  }

  if (
    patch.defaultLessonMode !== undefined &&
    !["online", "onsite"].includes(patch.defaultLessonMode)
  ) {
    throw new ValidationError("Ders modu 'online' veya 'onsite' olmalı.");
  }

  if (
    patch.lessonColorSaturation !== undefined &&
    (!Number.isFinite(patch.lessonColorSaturation) ||
      patch.lessonColorSaturation < 0.1 ||
      patch.lessonColorSaturation > 3)
  ) {
    throw new ValidationError("Ders rengi doygunluğu 0.1–3 arasında olmalı.");
  }

  if (patch.paymentMethodCash === false && patch.paymentMethodIban === false) {
    throw new ValidationError("En az bir ödeme yöntemi aktif olmalı.");
  }

  if (patch.paymentMethodCash === false && patch.paymentMethodIban === undefined) {
    const current = await getSettings();
    if (!current.paymentMethodIban) {
      throw new ValidationError("En az bir ödeme yöntemi aktif olmalı.");
    }
  }

  if (patch.paymentMethodIban === false && patch.paymentMethodCash === undefined) {
    const current = await getSettings();
    if (!current.paymentMethodCash) {
      throw new ValidationError("En az bir ödeme yöntemi aktif olmalı.");
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (patch.weeklyCapacity !== undefined) {
    sets.push(`weekly_capacity = $${i++}`);
    values.push(patch.weeklyCapacity);
  }
  if (patch.calendarStartHour !== undefined) {
    sets.push(`calendar_start_hour = $${i++}`);
    values.push(patch.calendarStartHour);
  }
  if (patch.calendarEndHour !== undefined) {
    sets.push(`calendar_end_hour = $${i++}`);
    values.push(patch.calendarEndHour);
  }
  if (patch.defaultLessonDuration !== undefined) {
    sets.push(`default_lesson_duration = $${i++}`);
    values.push(patch.defaultLessonDuration);
  }
  if (patch.defaultLessonMode !== undefined) {
    sets.push(`default_lesson_mode = $${i++}`);
    values.push(patch.defaultLessonMode);
  }
  if (patch.paymentMethodCash !== undefined) {
    sets.push(`payment_method_cash = $${i++}`);
    values.push(patch.paymentMethodCash);
  }
  if (patch.paymentMethodIban !== undefined) {
    sets.push(`payment_method_iban = $${i++}`);
    values.push(patch.paymentMethodIban);
  }
  if (patch.lessonColorSaturation !== undefined) {
    sets.push(`lesson_color_saturation = $${i++}`);
    values.push(patch.lessonColorSaturation);
  }

  if (sets.length === 0) {
    return getSettings();
  }

  sets.push(`updated_at = now()`);

  const before = await getSettings();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE studio_settings SET ${sets.join(", ")} WHERE id = 1 RETURNING *`,
      values,
    );
    const updated = rowToSettings(result.rows[0]);
    await insertAuditLog(client, {
      action: "settings_updated",
      entityType: "settings",
      entityId: 1,
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
