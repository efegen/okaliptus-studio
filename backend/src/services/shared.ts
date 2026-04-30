import type { PoolClient } from "pg";

import { CurrencyMismatchError, ValidationError } from "./errors.js";

export type EntityId = number | string;
export type MoneyInput = number | string;
export type LessonMode = "online" | "onsite";
export type LessonStatus = "scheduled" | "completed" | "cancelled" | "no_show";
export type PaymentSource = "cash" | "iban";
export type PaymentTargetType = "lesson" | "product_sale";

type NormalizeMoneyOptions = {
  allowNegative?: boolean;
  allowZero?: boolean;
};

type AuditLogInsert = {
  action: string;
  entityType: string;
  entityId: EntityId;
  before?: unknown;
  after?: unknown;
  note?: string | null;
  actorUserId?: number | string | null;
};

export function normalizeRequiredText(value: string, fieldName: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new ValidationError(`${fieldName} is required.`);
  }

  return trimmed;
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeMoneyInput(
  value: MoneyInput,
  fieldName: string,
  options: NormalizeMoneyOptions = {},
): string {
  const cents = moneyToCents(value, fieldName);

  if (!options.allowNegative && cents < 0n) {
    throw new ValidationError(`${fieldName} must be greater than or equal to 0.`);
  }

  if (!options.allowZero && cents === 0n) {
    throw new ValidationError(`${fieldName} must be greater than 0.`);
  }

  return centsToMoney(cents);
}

export function moneyToCents(value: MoneyInput, fieldName = "amount"): bigint {
  const normalized =
    typeof value === "number"
      ? normalizeNumberMoney(value, fieldName)
      : normalizeStringMoney(value, fieldName);

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [wholePart, fractionPart = ""] = unsigned.split(".");
  const cents = BigInt(wholePart) * 100n + BigInt((fractionPart + "00").slice(0, 2));

  return negative ? -cents : cents;
}

export function centsToMoney(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  const formatted = `${whole.toString()}.${fraction.toString().padStart(2, "0")}`;

  return negative ? `-${formatted}` : formatted;
}

export function assertTryCurrency(currency: string): void {
  if (currency !== "TRY") {
    throw new CurrencyMismatchError("Only TRY is supported in v1.");
  }
}

export async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Ignore rollback errors so we can preserve the original failure.
  }
}

export async function insertAuditLog(client: PoolClient, entry: AuditLogInsert): Promise<void> {
  await client.query(
    `
      INSERT INTO audit_logs (action, entity_type, entity_id, before, after, note, actor_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.before ?? null,
      entry.after ?? null,
      entry.note ?? null,
      entry.actorUserId ?? null,
    ],
  );
}

function normalizeNumberMoney(value: number, fieldName: string): string {
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${fieldName} must be a finite number.`);
  }

  return value.toFixed(2);
}

function normalizeStringMoney(value: string, fieldName: string): string {
  const trimmed = value.trim();

  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new ValidationError(`${fieldName} must be a decimal with up to 2 fractional digits.`);
  }

  return trimmed;
}
