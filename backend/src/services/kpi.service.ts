// Ref: §4.1–§4.7
import { pool } from "../db/connection.js";

type WeeklyKpiResult = {
  weekStart: string;
  weekEnd: string;
  cashInflow: {
    total: string;
    cash: string;
    iban: string;
  };
  revenue: {
    total: string;
    lesson: string;
    product: string;
  };
  lessonCounts: {
    planned: string;
    completed: string;
  };
  occupancyRatio: string | null;
  receivable: string;
  activeCreditValue: string;
  debtorStudentCount: string;
};

export async function getWeeklyKpi(): Promise<WeeklyKpiResult> {
  const result = await pool.query(`
    WITH
      -- §4 — Hafta penceresi: Europe/Istanbul timezone, Pazartesi başlangıçlı (ISO 8601)
      date_window AS (
        SELECT
          (date_trunc('week', now() AT TIME ZONE 'Europe/Istanbul')
            AT TIME ZONE 'Europe/Istanbul') AS week_start,
          (date_trunc('week', now() AT TIME ZONE 'Europe/Istanbul')
            AT TIME ZONE 'Europe/Istanbul' + INTERVAL '7 days') AS week_end
      ),

      -- §4.1 Tahsilat (cash + iban payments in the week)
      inflow AS (
        SELECT
          COALESCE(SUM(amount), 0)                                                   AS total,
          COALESCE(SUM(CASE WHEN source = 'cash' THEN amount ELSE 0 END), 0)         AS cash_total,
          COALESCE(SUM(CASE WHEN source = 'iban'  THEN amount ELSE 0 END), 0)        AS iban_total
        FROM payments, date_window
        WHERE paid_at >= date_window.week_start
          AND paid_at <  date_window.week_end
          AND source IN ('cash', 'iban')
          AND deleted_at IS NULL
      ),

      -- §4.2 Ciro — lesson (starts_at penceresi, completed dersler)
      -- Net tutar: price_snapshot - discount_amount (karar 7)
      lesson_rev AS (
        SELECT COALESCE(SUM(l.price_snapshot - l.discount_amount), 0) AS lesson_revenue
        FROM lessons l, date_window
        WHERE l.status = 'completed'
          AND l.starts_at >= date_window.week_start
          AND l.starts_at <  date_window.week_end
          AND l.deleted_at IS NULL
      ),

      -- §4.2 Ciro — product_sales (sold_at penceresi)
      product_rev AS (
        SELECT COALESCE(SUM(ps.total_amount), 0) AS product_revenue
        FROM product_sales ps, date_window
        WHERE ps.sold_at >= date_window.week_start
          AND ps.sold_at <  date_window.week_end
          AND ps.deleted_at IS NULL
      ),

      -- §4.3 Ders sayıları
      lesson_counts AS (
        SELECT
          COUNT(*) FILTER (WHERE l.status IN ('scheduled', 'completed', 'no_show')) AS planned,
          COUNT(*) FILTER (WHERE l.status = 'completed')                            AS completed
        FROM lessons l, date_window
        WHERE l.starts_at >= date_window.week_start
          AND l.starts_at <  date_window.week_end
          AND l.deleted_at IS NULL
      ),

      -- §4.5 Bekleyen Tahsilat (receivable)
      receivable AS (
        SELECT
          COALESCE(SUM(GREATEST(0, lb.remaining_receivable)), 0) +
          COALESCE(SUM(GREATEST(0, pb.remaining_receivable)), 0) AS total_receivable
        FROM
          (SELECT remaining_receivable FROM v_lesson_balances
           WHERE status = 'completed' AND prepaid_package_id IS NULL) lb
          FULL JOIN
          (SELECT remaining_receivable FROM v_product_sale_balances) pb
          ON FALSE
      ),

      -- §4.6 Aktif Kredi Değeri (deferred)
      deferred AS (
        SELECT COALESCE(SUM(GREATEST(0, remaining_credits) * unit_price), 0) AS active_credit_value
        FROM v_prepaid_package_status
      ),

      debtor_students AS (
        SELECT COUNT(*) AS debtor_student_count
        FROM v_student_summary
        WHERE (lesson_debt + product_debt) > 0.01
      )

    SELECT
      date_window.week_start::text AS week_start,
      date_window.week_end::text AS week_end,

      -- cash inflow
      inflow.total::text                  AS cash_inflow_total,
      inflow.cash_total::text             AS cash_inflow_cash,
      inflow.iban_total::text             AS cash_inflow_iban,

      -- revenue
      (lesson_rev.lesson_revenue + product_rev.product_revenue)::text AS revenue_total,
      lesson_rev.lesson_revenue::text                                  AS revenue_lesson,
      product_rev.product_revenue::text                                AS revenue_product,

      -- lesson counts
      lesson_counts.planned::text,
      lesson_counts.completed::text,

      -- §4.4 Doluluk — capacity inlined as scalar subquery (avoids FROM/JOIN mixing issue)
      CASE
        WHEN (SELECT weekly_capacity FROM studio_settings WHERE id = 1) IS NOT NULL
         AND (SELECT weekly_capacity FROM studio_settings WHERE id = 1) > 0
        THEN ROUND(
               lesson_counts.planned::numeric
                 / (SELECT weekly_capacity FROM studio_settings WHERE id = 1)::numeric,
               4
             )::text
        ELSE NULL
      END AS occupancy_ratio,

      -- financial health
      receivable.total_receivable::text               AS receivable,
      deferred.active_credit_value::text              AS active_credit_value,
      debtor_students.debtor_student_count::text      AS debtor_student_count

    FROM date_window, inflow, lesson_rev, product_rev, lesson_counts, receivable, deferred, debtor_students
  `);

  const row = result.rows[0];
  if (!row) {
    throw new Error("KPI sorgusu sonuç döndürmedi");
  }

  const r = row as Record<string, string | null>;

  return {
    weekStart: r["week_start"] as string,
    weekEnd: r["week_end"] as string,
    cashInflow: {
      total: r["cash_inflow_total"] as string,
      cash: r["cash_inflow_cash"] as string,
      iban: r["cash_inflow_iban"] as string,
    },
    revenue: {
      total: r["revenue_total"] as string,
      lesson: r["revenue_lesson"] as string,
      product: r["revenue_product"] as string,
    },
    lessonCounts: {
      planned: r["planned"] as string,
      completed: r["completed"] as string,
    },
    occupancyRatio: r["occupancy_ratio"],
    receivable: r["receivable"] as string,
    activeCreditValue: r["active_credit_value"] as string,
    debtorStudentCount: r["debtor_student_count"] as string,
  };
}
