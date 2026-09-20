// Kullanıcı aktivite özeti — bkz. migration 0288. Ping: istemci gerçek
// etkileşimde çağırır. Liste: yalnız owner (users.manage) okur.

import { pool } from "../db/connection.js";

const SESSION_GAP_MINUTES = 15;
const ONLINE_WINDOW_MINUTES = 2;
const RETENTION_DAYS = 90;
const HISTORY_DAYS = 30;
const FIRST_PING_CREDIT_SECONDS = 30;
const MAX_PING_CREDIT_SECONDS = 90;

const TODAY_SQL = `(now() AT TIME ZONE 'Europe/Istanbul')::date`;

export async function recordActivity(userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_activity_days (user_id, day, session_count, last_active_at, first_active_at, active_seconds)
     VALUES ($1, ${TODAY_SQL}, 1, now(), now(), ${FIRST_PING_CREDIT_SECONDS})
     ON CONFLICT (user_id, day) DO UPDATE
       SET active_seconds = user_activity_days.active_seconds
             + CASE WHEN now() - user_activity_days.last_active_at > make_interval(mins => ${SESSION_GAP_MINUTES})
                    THEN ${FIRST_PING_CREDIT_SECONDS}
                    ELSE LEAST(EXTRACT(EPOCH FROM now() - user_activity_days.last_active_at), ${MAX_PING_CREDIT_SECONDS})::int END,
           session_count = user_activity_days.session_count
             + CASE WHEN now() - user_activity_days.last_active_at > make_interval(mins => ${SESSION_GAP_MINUTES})
                    THEN 1 ELSE 0 END,
           last_active_at = now()`,
    [userId],
  );

  // Fırsatçı saklama temizliği (küçük tablo; her ping'de çalışmasına gerek yok).
  if (Math.random() < 0.01) {
    await pool
      .query(`DELETE FROM user_activity_days WHERE day < ${TODAY_SQL} - $1::int`, [RETENTION_DAYS])
      .catch(() => {});
  }
}

export type UserActivity = {
  userId: string;
  lastActiveAt: string | null;
  isOnline: boolean;
  todaySessions: number;
  todaySeconds: number;
  todayFirstAt: string | null;
  history: Array<{ day: string; sessions: number; seconds: number }>;
};

export async function listUserActivity(): Promise<UserActivity[]> {
  const summary = await pool.query<{
    user_id: string;
    last_active_at: string | null;
    is_online: boolean;
    today_sessions: number;
    today_seconds: number;
    today_first_at: string | null;
  }>(
    `SELECT u.id AS user_id,
            max(a.last_active_at) AS last_active_at,
            COALESCE(max(a.last_active_at) > now() - make_interval(mins => ${ONLINE_WINDOW_MINUTES}), false) AS is_online,
            COALESCE(max(a.session_count) FILTER (WHERE a.day = ${TODAY_SQL}), 0)::int AS today_sessions,
            COALESCE(max(a.active_seconds) FILTER (WHERE a.day = ${TODAY_SQL}), 0)::int AS today_seconds,
            max(a.first_active_at) FILTER (WHERE a.day = ${TODAY_SQL}) AS today_first_at
       FROM users u
       LEFT JOIN user_activity_days a ON a.user_id = u.id
      GROUP BY u.id`,
  );
  const hist = await pool.query<{ user_id: string; day: string; session_count: number; active_seconds: number }>(
    `SELECT user_id, day::text AS day, session_count, active_seconds
       FROM user_activity_days
      WHERE day >= ${TODAY_SQL} - $1::int
      ORDER BY day DESC`,
    [HISTORY_DAYS - 1],
  );
  const byUser = new Map<string, Array<{ day: string; sessions: number; seconds: number }>>();
  for (const h of hist.rows) {
    const k = String(h.user_id);
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k)!.push({ day: h.day, sessions: h.session_count, seconds: h.active_seconds });
  }
  return summary.rows.map((r) => ({
    userId: String(r.user_id),
    lastActiveAt: r.last_active_at,
    isOnline: r.is_online,
    todaySessions: r.today_sessions,
    todaySeconds: r.today_seconds,
    todayFirstAt: r.today_first_at,
    history: byUser.get(String(r.user_id)) ?? [],
  }));
}
