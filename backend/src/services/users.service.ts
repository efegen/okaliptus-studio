import bcrypt from "bcryptjs";

import { pool } from "../db/connection.js";
import { isRole, type Role } from "../auth/permissions.js";
import { insertAuditLog, normalizeRequiredText, rollbackQuietly } from "./shared.js";
import {
  LastOwnerError,
  SelfUpdateForbiddenError,
  UserNotFoundError,
  ValidationError,
  toServiceError,
} from "./errors.js";

const BCRYPT_COST = 12;

export type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

type ManagedUserRow = {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
};

function toManagedUser(row: ManagedUserRow): ManagedUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

const SELECT_MANAGED_USER = `
  SELECT
    u.id,
    u.username,
    u.display_name,
    u.role,
    u.is_active,
    u.created_at,
    (
      SELECT max(a.created_at)
      FROM audit_logs a
      WHERE a.action = 'user_login' AND a.entity_type = 'user' AND a.entity_id = u.id
    ) AS last_login_at
  FROM users u
`;

export async function listUsers(): Promise<ManagedUser[]> {
  const result = await pool.query<ManagedUserRow>(
    `${SELECT_MANAGED_USER} ORDER BY u.id ASC`,
  );
  return result.rows.map(toManagedUser);
}

function normalizeUsername(value: string): string {
  const trimmed = normalizeRequiredText(value, "username");
  if (trimmed.length < 3 || trimmed.length > 50 || /\s/.test(trimmed)) {
    throw new ValidationError(
      "Kullanıcı adı 3-50 karakter olmalı ve boşluk içermemeli.",
    );
  }
  return trimmed;
}

function normalizePassword(value: string): string {
  if (typeof value !== "string" || value.length < 6 || value.length > 100) {
    throw new ValidationError("Şifre 6-100 karakter olmalı.");
  }
  return value;
}

function normalizeRole(value: string): Role {
  if (!isRole(value)) {
    throw new ValidationError("Geçersiz rol.");
  }
  return value;
}

export async function createUser(
  input: { username: string; displayName: string; password: string; role: Role },
  actorUserId: string,
): Promise<ManagedUser> {
  const username = normalizeUsername(input.username);
  const displayName = normalizeRequiredText(input.displayName, "displayName");
  const password = normalizePassword(input.password);
  const role = normalizeRole(input.role);

  const hash = await bcrypt.hash(password, BCRYPT_COST);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query<{ id: string }>(
      `INSERT INTO users (username, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [username, displayName, hash, role],
    );
    const id = result.rows[0].id;

    await insertAuditLog(client, {
      action: "user_created",
      entityType: "user",
      entityId: id,
      after: { username, displayName, role },
      actorUserId,
    });

    const row = await client.query<ManagedUserRow>(
      `${SELECT_MANAGED_USER} WHERE u.id = $1`,
      [id],
    );

    await client.query("COMMIT");
    return toManagedUser(row.rows[0]);
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function updateUser(
  userId: string,
  patch: { displayName?: string; role?: Role; isActive?: boolean },
  actorUserId: string,
): Promise<ManagedUser> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeResult = await client.query<ManagedUserRow>(
      `SELECT id, username, display_name, role, is_active, created_at, NULL AS last_login_at
       FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const before = beforeResult.rows[0];
    if (!before) {
      throw new UserNotFoundError();
    }

    const isSelf = String(actorUserId) === String(userId);
    const demotesOwnOwnerRole =
      isSelf && patch.role !== undefined && before.role === "owner" && patch.role !== "owner";
    const deactivatesSelf = isSelf && patch.isActive === false;
    if (demotesOwnOwnerRole || deactivatesSelf) {
      throw new SelfUpdateForbiddenError();
    }

    const demotesFromOwner = patch.role !== undefined && before.role === "owner" && patch.role !== "owner";
    const deactivatesOwner = patch.isActive === false && before.role === "owner";
    if ((demotesFromOwner || deactivatesOwner) && before.is_active) {
      const otherOwners = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users WHERE role = 'owner' AND is_active = true AND id <> $1`,
        [userId],
      );
      if (Number(otherOwners.rows[0].count) === 0) {
        throw new LastOwnerError();
      }
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (patch.displayName !== undefined) {
      setClauses.push(`display_name = $${idx++}`);
      values.push(normalizeRequiredText(patch.displayName, "displayName"));
    }
    if (patch.role !== undefined) {
      setClauses.push(`role = $${idx++}`);
      values.push(normalizeRole(patch.role));
    }
    if (patch.isActive !== undefined) {
      setClauses.push(`is_active = $${idx++}`);
      values.push(patch.isActive);
    }

    if (setClauses.length === 0) {
      throw new ValidationError("Güncellenecek alan yok.");
    }

    values.push(userId);
    await client.query(
      `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${idx}`,
      values,
    );

    if (patch.isActive === false) {
      // Pasifleştirme oturumları anında keser — panelden yapılan yetki
      // kısıtlaması bir sonraki isteğe kadar değil, hemen etkili olmalı.
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    }

    if (patch.role !== undefined && patch.role !== before.role) {
      await insertAuditLog(client, {
        action: "user_role_changed",
        entityType: "user",
        entityId: userId,
        before: { role: before.role },
        after: { role: patch.role },
        actorUserId,
      });
    }
    if (patch.displayName !== undefined && patch.displayName !== before.display_name) {
      await insertAuditLog(client, {
        action: "user_updated",
        entityType: "user",
        entityId: userId,
        before: { displayName: before.display_name },
        after: { displayName: patch.displayName },
        actorUserId,
      });
    }
    if (patch.isActive !== undefined && patch.isActive !== before.is_active) {
      await insertAuditLog(client, {
        action: patch.isActive ? "user_reactivated" : "user_deactivated",
        entityType: "user",
        entityId: userId,
        before: { isActive: before.is_active },
        after: { isActive: patch.isActive },
        actorUserId,
      });
    }

    const row = await client.query<ManagedUserRow>(
      `${SELECT_MANAGED_USER} WHERE u.id = $1`,
      [userId],
    );

    await client.query("COMMIT");
    return toManagedUser(row.rows[0]);
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function setUserPassword(
  userId: string,
  newPassword: string,
  actorUserId: string,
): Promise<void> {
  const password = normalizePassword(newPassword);
  const hash = await bcrypt.hash(password, BCRYPT_COST);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query<{ id: string }>(
      `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id`,
      [hash, userId],
    );
    if (result.rowCount === 0) {
      throw new UserNotFoundError();
    }

    // Kendi şifresini sıfırlıyorsa mevcut oturumu düşürme; başkasınınkiyse
    // tüm oturumlarını anında kapat.
    if (String(actorUserId) !== String(userId)) {
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    }

    await insertAuditLog(client, {
      action: "user_password_reset",
      entityType: "user",
      entityId: userId,
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
