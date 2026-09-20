// Not gövdesindeki kullanıcı etiketi belirteçleri `@{u:<id>}` (bkz. migration
// 0290) düz metne çevrilir: "@Efe". Push bildirimi gibi belirteci gösteremeyen
// yerlerde kullanılır. Bilinmeyen id → "@Kullanıcı".

import { pool } from "../db/connection.js";

const USER_TOKEN_RE = /@\{u:(\d+)\}/g;

export async function renderNoteBodyPlain(body: string): Promise<string> {
  const ids = [...new Set([...body.matchAll(USER_TOKEN_RE)].map((m) => m[1]))];
  if (ids.length === 0) return body;

  const { rows } = await pool.query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM users WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  const names = new Map(rows.map((r) => [String(r.id), r.display_name]));
  return body.replace(USER_TOKEN_RE, (_m, id: string) => `@${names.get(id) ?? "Kullanıcı"}`);
}
