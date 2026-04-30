import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db/connection.js';

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

// Prevents username enumeration via timing difference when user not found.
const DUMMY_HASH = '$2a$12$invalidhashfortimingprotection0000000000000000000000000';

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
};

export async function login(username: string, password: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT id, password_hash FROM users WHERE username = $1 AND is_active = true`,
    [username],
  );
  const user = result.rows[0] ?? null;
  const hash = user?.password_hash ?? DUMMY_HASH;
  const valid = await bcrypt.compare(password, hash);

  if (!user || !valid) return null;

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_MS);
  await pool.query(
    `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [user.id, token, expiresAt],
  );
  return token;
}

export async function validateSession(token: string): Promise<AuthUser | null> {
  const result = await pool.query(
    `SELECT u.id, u.username, u.display_name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1
       AND s.expires_at > now()
       AND u.is_active = true`,
    [token],
  );
  const row = result.rows[0];
  if (!row) return null;

  pool.query(`UPDATE sessions SET last_seen_at = now() WHERE token = $1`, [token]).catch(() => {});

  return {
    id: String(row.id),
    username: row.username as string,
    displayName: row.display_name as string,
  };
}

export async function logout(token: string): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
}
