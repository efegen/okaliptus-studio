import { Router } from "express";
import { pool } from "../../db/connection.js";
import { sendError } from "../middleware/response.js";

export const auditRouter = Router();

type AuditLogRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  note: string | null;
  created_at: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  student_name: string | null;
};

// GET /audit-logs
// Query params: from, to, actions (comma-separated), actor_user_id, entity_type,
//               entity_id, q (student name ilike search), page, limit
auditRouter.get("/", async (req, res) => {
  try {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (req.query.from) {
      conditions.push(`a.created_at >= $${idx++}`);
      values.push(String(req.query.from));
    }

    if (req.query.to) {
      conditions.push(`a.created_at < $${idx++}`);
      values.push(String(req.query.to));
    }

    if (req.query.actions) {
      const actions = String(req.query.actions).split(",").map(s => s.trim()).filter(Boolean);
      if (actions.length > 0) {
        conditions.push(`a.action = ANY($${idx++})`);
        values.push(actions);
      }
    }

    if (req.query.actor_user_id) {
      const actorId = Number(req.query.actor_user_id);
      if (Number.isFinite(actorId)) {
        conditions.push(`a.actor_user_id = $${idx++}`);
        values.push(actorId);
      }
    }

    if (req.query.entity_type) {
      conditions.push(`a.entity_type = $${idx++}`);
      values.push(String(req.query.entity_type));
    }

    if (req.query.entity_id) {
      const entityId = Number(req.query.entity_id);
      if (Number.isFinite(entityId)) {
        conditions.push(`a.entity_id = $${idx++}`);
        values.push(entityId);
      }
    }

    const qSearch = req.query.q ? String(req.query.q).trim() : null;
    if (qSearch) {
      conditions.push(`(
        (a.entity_type = 'student' AND s1.full_name ILIKE $${idx})
        OR (a.entity_type = 'lesson' AND s2.full_name ILIKE $${idx})
      )`);
      values.push(`%${qSearch}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const dataQuery = `
      SELECT
        a.id::text,
        a.action,
        a.entity_type,
        a.entity_id::text,
        a.before,
        a.after,
        a.note,
        a.created_at,
        a.actor_user_id::text,
        u.display_name AS actor_display_name,
        CASE
          WHEN a.entity_type = 'student' THEN s1.full_name
          WHEN a.entity_type = 'lesson'  THEN s2.full_name
          ELSE NULL
        END AS student_name
      FROM audit_logs a
      LEFT JOIN users u
        ON u.id = a.actor_user_id
      LEFT JOIN students s1
        ON a.entity_type = 'student' AND s1.id = a.entity_id AND s1.deleted_at IS NULL
      LEFT JOIN lessons l
        ON a.entity_type = 'lesson' AND l.id = a.entity_id AND l.deleted_at IS NULL
      LEFT JOIN students s2
        ON l.student_id = s2.id AND s2.deleted_at IS NULL
      ${whereClause}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    values.push(limit + 1, offset);

    const result = await pool.query<AuditLogRow>(dataQuery, values);
    const rows = result.rows;
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    res.json({ data, page, limit, hasMore });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /audit-logs/users — admin kullanıcı listesi (filtre dropdown için)
auditRouter.get("/users", async (_req, res) => {
  try {
    const result = await pool.query<{ id: string; display_name: string }>(
      `SELECT id::text, display_name FROM users WHERE is_active ORDER BY display_name`,
    );
    res.json({ data: result.rows });
  } catch (err) {
    sendError(res, err);
  }
});
