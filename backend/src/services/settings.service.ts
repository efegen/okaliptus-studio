import { pool } from "../db/connection.js";
import { ValidationError, toServiceError } from "./errors.js";
import { insertAuditLog, rollbackQuietly } from "./shared.js";

export type StudioSettings = {
  weeklyCapacity: number;
  weekStart: string;
  calendarStartHour: number;
  calendarEndHour: number;
  defaultCurrency: string;
  lessonColorSaturation: number;
  stockTrackingEnabled: boolean;
  marketplaceSyncEnabled: boolean;
  marketplaceOrdersEnabled: boolean;
  marketplaceStockPushEnabled: boolean;
  marketplaceStockPushDryRun: boolean;
};

function rowToSettings(row: Record<string, unknown>): StudioSettings {
  return {
    weeklyCapacity: Number(row.weekly_capacity),
    weekStart: row.week_start as string,
    calendarStartHour: Number(row.calendar_start_hour),
    calendarEndHour: Number(row.calendar_end_hour),
    defaultCurrency: row.default_currency as string,
    lessonColorSaturation: Number(row.lesson_color_saturation ?? 1),
    stockTrackingEnabled: row.stock_tracking_enabled === true,
    marketplaceSyncEnabled: row.marketplace_sync_enabled === true,
    marketplaceOrdersEnabled: row.marketplace_orders_enabled === true,
    marketplaceStockPushEnabled: row.marketplace_stock_push_enabled === true,
    marketplaceStockPushDryRun: row.marketplace_stock_push_dry_run === true,
  };
}

export async function getSettings(): Promise<StudioSettings> {
  const result = await pool.query(`
    SELECT
      weekly_capacity, week_start,
      calendar_start_hour, calendar_end_hour,
      default_currency,
      lesson_color_saturation,
      stock_tracking_enabled,
      marketplace_sync_enabled,
      marketplace_orders_enabled,
      marketplace_stock_push_enabled,
      marketplace_stock_push_dry_run
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
  lessonColorSaturation?: number;
  stockTrackingEnabled?: boolean;
  marketplaceSyncEnabled?: boolean;
  marketplaceOrdersEnabled?: boolean;
  marketplaceStockPushEnabled?: boolean;
  marketplaceStockPushDryRun?: boolean;
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
    patch.lessonColorSaturation !== undefined &&
    (!Number.isFinite(patch.lessonColorSaturation) ||
      patch.lessonColorSaturation < 0.1 ||
      patch.lessonColorSaturation > 3)
  ) {
    throw new ValidationError("Ders rengi doygunluğu 0.1–3 arasında olmalı.");
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
  if (patch.lessonColorSaturation !== undefined) {
    sets.push(`lesson_color_saturation = $${i++}`);
    values.push(patch.lessonColorSaturation);
  }
  if (patch.stockTrackingEnabled !== undefined) {
    sets.push(`stock_tracking_enabled = $${i++}`);
    values.push(patch.stockTrackingEnabled);
  }
  if (patch.marketplaceSyncEnabled !== undefined) {
    sets.push(`marketplace_sync_enabled = $${i++}`);
    values.push(patch.marketplaceSyncEnabled);
  }
  if (patch.marketplaceOrdersEnabled !== undefined) {
    sets.push(`marketplace_orders_enabled = $${i++}`);
    values.push(patch.marketplaceOrdersEnabled);
  }
  if (patch.marketplaceStockPushEnabled !== undefined) {
    sets.push(`marketplace_stock_push_enabled = $${i++}`);
    values.push(patch.marketplaceStockPushEnabled);
  }
  if (patch.marketplaceStockPushDryRun !== undefined) {
    sets.push(`marketplace_stock_push_dry_run = $${i++}`);
    values.push(patch.marketplaceStockPushDryRun);
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
