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

export async function login(username: string, password: string, ip?: string): Promise<string | null> {
  if (typeof password !== 'string' || password.length < 6) return null;

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

  // Güvenlik denetimi: başarılı login audit_logs'a yazılır. login transaction
  // kullanmaz; pool.query yeterli. Audit hatası login akışını bozmasın.
  await pool.query(
    `INSERT INTO audit_logs (action, entity_type, entity_id, note, actor_user_id)
     VALUES ('user_login', 'user', $1, $2, $1)`,
    [user.id, `Başarılı giriş — IP: ${ip ?? 'bilinmiyor'}`],
  ).catch(() => {});

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

  // Sliding window — await edilir ki testler güncellemeyi anında görsün; hata
  // session'u invalidate etmesin diye .catch ile yutulur.
  await pool.query(
    `UPDATE sessions
       SET last_seen_at = now(),
           expires_at   = now() + interval '30 days'
     WHERE token = $1`,
    [token],
  ).catch(() => {});

  return {
    id: String(row.id),
    username: row.username as string,
    displayName: row.display_name as string,
  };
}

export async function logout(token: string, ip?: string): Promise<void> {
  // DELETE öncesi token sahibini oku ki audit kaydında entity/actor doldurulsun.
  const owner = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM sessions WHERE token = $1`,
    [token],
  );
  const userId = owner.rows[0]?.user_id ?? null;

  await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);

  // Güvenlik denetimi: başarılı logout audit_logs'a yazılır. user_id
  // bulunamazsa (token zaten geçersiz) audit atlanır. Audit hatası akışı bozmasın.
  if (userId !== null) {
    await pool.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, note, actor_user_id)
       VALUES ('user_logout', 'user', $1, $2, $1)`,
      [userId, `Çıkış yapıldı — IP: ${ip ?? 'bilinmiyor'}`],
    ).catch(() => {});
  }
}
