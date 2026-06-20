// v1.6 — Kanal eşleştirme servisi (channel_listings).
//
// İÇ veri modeli CRUD'u: iç ürün ↔ Trendyol/Hepsiburada listing eşlemesi, kanal
// fiyatı, "listeli mi" bayrağı. Hiçbir dış API çağrısı YOK — sadece tablo işlemi.
// Marketplace işleri studio_settings.marketplace_sync_enabled arkasında (UI gizler).

import { pool } from "../db/connection.js";
import { AppError, ValidationError, toServiceError } from "./errors.js";
import { ProductNotFoundError } from "./products.service.js";
import {
  insertAuditLog,
  normalizeMoneyInput,
  normalizeRequiredText,
  rollbackQuietly,
  type EntityId,
  type MoneyInput,
} from "./shared.js";

export const CHANNELS = ["trendyol", "hepsiburada"] as const;
export type Channel = (typeof CHANNELS)[number];

export type ChannelListingRow = {
  id: string;
  product_id: string;
  channel: Channel;
  external_id: string;
  channel_price: string | null;
  is_listed: boolean;
  created_at: string;
  updated_at: string;
};

export class ChannelListingNotFoundError extends AppError {
  constructor(message = "Kanal eşleştirmesi bulunamadı.") {
    super("CHANNEL_LISTING_NOT_FOUND", message, 404);
  }
}

export class ChannelListingConflictError extends AppError {
  constructor(message = "Bu kanalda bu external_id zaten başka bir üründe kayıtlı.") {
    super("CHANNEL_LISTING_CONFLICT", message, 409);
  }
}

export type CreateChannelListingInput = {
  channel: Channel | string;
  externalId: string;
  channelPrice?: MoneyInput | null;
  isListed?: boolean;
  actorUserId?: number | string | null;
};

export type UpdateChannelListingInput = {
  channelPrice?: MoneyInput | null;
  isListed?: boolean;
  actorUserId?: number | string | null;
};

function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNELS as readonly string[]).includes(value);
}

export async function listByProduct(productId: EntityId): Promise<ChannelListingRow[]> {
  const result = await pool.query<ChannelListingRow>(
    `SELECT * FROM channel_listings WHERE product_id = $1 ORDER BY channel ASC, id ASC`,
    [productId],
  );
  return result.rows;
}

export async function createChannelListing(
  productId: EntityId,
  input: CreateChannelListingInput,
): Promise<ChannelListingRow> {
  if (!isChannel(input.channel)) {
    throw new ValidationError("channel 'trendyol' veya 'hepsiburada' olmalı.");
  }
  const externalId = normalizeRequiredText(String(input.externalId ?? ""), "externalId");
  const channelPrice =
    input.channelPrice === undefined || input.channelPrice === null || input.channelPrice === ""
      ? null
      : normalizeMoneyInput(input.channelPrice, "channelPrice");
  const isListed = input.isListed === undefined ? true : !!input.isListed;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ürün var mı? (FK CASCADE var ama net hata için açık kontrol.)
    const prod = await client.query<{ id: string }>(
      `SELECT id FROM products WHERE id = $1`,
      [productId],
    );
    if (!prod.rows[0]) throw new ProductNotFoundError();

    // UNIQUE (channel, external_id) için ön-kontrol — temiz 409 mesajı.
    // DB kısıtı asıl güvence (yarış durumunda backstop).
    const conflict = await client.query<{ id: string }>(
      `SELECT id FROM channel_listings WHERE channel = $1 AND external_id = $2 LIMIT 1`,
      [input.channel, externalId],
    );
    if (conflict.rows[0]) throw new ChannelListingConflictError();

    const result = await client.query<ChannelListingRow>(
      `INSERT INTO channel_listings (product_id, channel, external_id, channel_price, is_listed)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [productId, input.channel, externalId, channelPrice, isListed],
    );
    const row = result.rows[0];

    await insertAuditLog(client, {
      action: "channel_listing_changed",
      entityType: "product",
      entityId: row.product_id,
      after: row,
      note: "channel listing created",
      actorUserId: input.actorUserId ?? null,
    });

    await client.query("COMMIT");
    return row;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function updateChannelListing(
  listingId: EntityId,
  input: UpdateChannelListingInput,
): Promise<ChannelListingRow> {
  if (input.channelPrice === undefined && input.isListed === undefined) {
    throw new ValidationError("Güncellenecek alan yok (channelPrice veya isListed).");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeResult = await client.query<ChannelListingRow>(
      `SELECT * FROM channel_listings WHERE id = $1 FOR UPDATE`,
      [listingId],
    );
    const before = beforeResult.rows[0];
    if (!before) throw new ChannelListingNotFoundError();

    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.channelPrice !== undefined) {
      const price =
        input.channelPrice === null || input.channelPrice === ""
          ? null
          : normalizeMoneyInput(input.channelPrice, "channelPrice");
      values.push(price);
      sets.push(`channel_price = $${values.length}`);
    }
    if (input.isListed !== undefined) {
      values.push(!!input.isListed);
      sets.push(`is_listed = $${values.length}`);
    }

    values.push(listingId);
    const updateResult = await client.query<ChannelListingRow>(
      `UPDATE channel_listings SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    const updated = updateResult.rows[0];

    await insertAuditLog(client, {
      action: "channel_listing_changed",
      entityType: "product",
      entityId: updated.product_id,
      before,
      after: updated,
      note: "channel listing updated",
      actorUserId: input.actorUserId ?? null,
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

export async function removeChannelListing(
  listingId: EntityId,
  actorUserId: number | string | null = null,
): Promise<{ id: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeResult = await client.query<ChannelListingRow>(
      `SELECT * FROM channel_listings WHERE id = $1 FOR UPDATE`,
      [listingId],
    );
    const before = beforeResult.rows[0];
    if (!before) throw new ChannelListingNotFoundError();

    await client.query(`DELETE FROM channel_listings WHERE id = $1`, [listingId]);

    await insertAuditLog(client, {
      action: "channel_listing_changed",
      entityType: "product",
      entityId: before.product_id,
      before,
      note: "channel listing removed",
      actorUserId,
    });

    await client.query("COMMIT");
    return { id: before.id };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}
