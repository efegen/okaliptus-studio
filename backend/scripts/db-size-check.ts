import "dotenv/config";
import { pool } from "../src/db/connection.js";

const r = await pool.query(`
  SELECT
    pg_size_pretty(pg_database_size(current_database())) AS db_total,
    pg_size_pretty(pg_total_relation_size('audit_logs')) AS audit_logs_size,
    (SELECT count(*) FROM audit_logs)::text AS audit_rows,
    (SELECT count(*) FROM lessons)::text AS lessons_rows,
    (SELECT count(*) FROM students)::text AS students_rows,
    (SELECT count(*) FROM products)::text AS products_rows
`);
console.table(r.rows[0]);
await pool.end();
