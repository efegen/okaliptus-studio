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
  totalStudentCount: string;
  activeStudentCount: string;
  monthStart: string;
  monthlyCashInflow: {
    total: string;
  };
  monthlyRevenue: {
    total: string;
  };
  last30Start: string;
  last30CashInflow: {
    total: string;
  };
  last30Revenue: {
    total: string;
  };
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

      -- Ay penceresi: cari ay başı ve sonu
      month_window AS (
        SELECT
          (date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul')
            AT TIME ZONE 'Europe/Istanbul') AS month_start,
          (date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul')
            AT TIME ZONE 'Europe/Istanbul' + INTERVAL '1 month') AS month_end
      ),

      -- Son 30 gün penceresi: now() - 30 gün → now()
      last30_window AS (
        SELECT
          (now() - INTERVAL '30 days') AS last30_start,
          now()                        AS last30_end
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
      ),

      total_students AS (
        SELECT
          COUNT(*)                                                          AS total_student_count,
          COUNT(*) FILTER (WHERE s.id IN (
            SELECT DISTINCT student_id FROM lessons
            WHERE status = 'completed'
              AND starts_at >= now() - INTERVAL '30 days'
              AND deleted_at IS NULL
          ))                                                                AS active_student_count
        FROM students s
        WHERE s.deleted_at IS NULL
      ),

      -- Aylık tahsilat (cash + iban)
      monthly_inflow AS (
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM payments, month_window
        WHERE paid_at >= month_window.month_start
          AND paid_at <  month_window.month_end
          AND source IN ('cash', 'iban')
          AND deleted_at IS NULL
      ),

      -- Aylık ciro (tamamlanmış dersler + ürün satışları)
      monthly_lesson_rev AS (
        SELECT COALESCE(SUM(l.price_snapshot - l.discount_amount), 0) AS lesson_revenue
        FROM lessons l, month_window
        WHERE l.status = 'completed'
          AND l.starts_at >= month_window.month_start
          AND l.starts_at <  month_window.month_end
          AND l.deleted_at IS NULL
      ),

      monthly_product_rev AS (
        SELECT COALESCE(SUM(ps.total_amount), 0) AS product_revenue
        FROM product_sales ps, month_window
        WHERE ps.sold_at >= month_window.month_start
          AND ps.sold_at <  month_window.month_end
          AND ps.deleted_at IS NULL
      ),

      -- Son 30 gün tahsilat (cash + iban)
      last30_inflow AS (
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM payments, last30_window
        WHERE paid_at >= last30_window.last30_start
          AND paid_at <  last30_window.last30_end
          AND source IN ('cash', 'iban')
          AND deleted_at IS NULL
      ),

      -- Son 30 gün ciro (tamamlanmış dersler + ürün satışları)
      last30_lesson_rev AS (
        SELECT COALESCE(SUM(l.price_snapshot - l.discount_amount), 0) AS lesson_revenue
        FROM lessons l, last30_window
        WHERE l.status = 'completed'
          AND l.starts_at >= last30_window.last30_start
          AND l.starts_at <  last30_window.last30_end
          AND l.deleted_at IS NULL
      ),

      last30_product_rev AS (
        SELECT COALESCE(SUM(ps.total_amount), 0) AS product_revenue
        FROM product_sales ps, last30_window
        WHERE ps.sold_at >= last30_window.last30_start
          AND ps.sold_at <  last30_window.last30_end
          AND ps.deleted_at IS NULL
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
      debtor_students.debtor_student_count::text      AS debtor_student_count,
      total_students.total_student_count::text        AS total_student_count,
      total_students.active_student_count::text       AS active_student_count,

      -- aylık finansal
      month_window.month_start::text                                                              AS month_start,
      monthly_inflow.total::text                                                                  AS monthly_cash_inflow_total,
      (monthly_lesson_rev.lesson_revenue + monthly_product_rev.product_revenue)::text             AS monthly_revenue_total,

      -- son 30 gün finansal
      last30_window.last30_start::text                                                            AS last30_start,
      last30_inflow.total::text                                                                   AS last30_cash_inflow_total,
      (last30_lesson_rev.lesson_revenue + last30_product_rev.product_revenue)::text               AS last30_revenue_total

    FROM date_window, month_window, last30_window, inflow, lesson_rev, product_rev, lesson_counts, receivable, deferred, debtor_students, total_students,
         monthly_inflow, monthly_lesson_rev, monthly_product_rev,
         last30_inflow, last30_lesson_rev, last30_product_rev
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
    totalStudentCount: r["total_student_count"] as string,
    activeStudentCount: r["active_student_count"] as string,
    monthStart: r["month_start"] as string,
    monthlyCashInflow: {
      total: r["monthly_cash_inflow_total"] as string,
    },
    monthlyRevenue: {
      total: r["monthly_revenue_total"] as string,
    },
    last30Start: r["last30_start"] as string,
    last30CashInflow: {
      total: r["last30_cash_inflow_total"] as string,
    },
    last30Revenue: {
      total: r["last30_revenue_total"] as string,
    },
  };
}

// ─── Finans · Akış (A1-K2) ───────────────────────────────────────────────────
// Mobil "Finans" ekranı için yapısal veri. Hafta ve Ay olmak üzere iki dönem;
// her dönem için zaman serisi (grafik), kasa girişi, tamamlanan/planlı ders ve
// "kazanç nereden geldi" kaynak dökümü. Para birimi yalnız TRY; tüm sayılar
// ::text olarak döner (mevcut KPI sözleşmesiyle aynı), istemci Number() ile
// ayrıştırır ve Türkçe metinleri/etiketleri kendisi kurar.
//
// Tanımlar (spec invariantlarıyla uyumlu):
//   - kazanç (earnings) = tamamlanmış ders neti (price_snapshot − discount) +
//     ürün satışı toplamı. scheduled/cancelled/no_show kazanç yaratmaz.
//   - Kaynak dökümü:  Tek ders     = paket-DIŞI tamamlanmış ders neti
//                     Ön ödemeli   = paket kredili tamamlanmış ders neti
//                     Ürün satışı  = product_sales.total_amount
//     (single + package = ders neti; + product = toplam kazanç — birbirini tutar)
//   - Kasaya giren (cashInflow) = dönem içi nakit + IBAN tahsilat (payments).
//   - Önceki dönem (prevEarnings) "aynı günlere kadar" karşılaştırmasıdır:
//     hafta için [Pzt−7g, şimdi−7g), ay için [ay başı−1ay, şimdi−1ay). Böylece
//     devam eden (kısmi) dönem, geçen dönemin tamamı yerine eşit uzunlukta bir
//     pencereyle kıyaslanır.

export type FinanceFlowSeriesPoint = {
  start: string;            // 'YYYY-MM-DD' (Istanbul) — dönem başlangıcı
  lesson: string;           // tamamlanmış ders neti
  product: string;          // ürün satışı toplamı
  completedLessons: string; // tamamlanmış ders adedi
  cashTotal: string;        // dönem içi kasaya giren (nakit + IBAN)
  cashCash: string;         // dönem içi nakit tahsilat
  cashIban: string;         // dönem içi IBAN tahsilat
  outstanding: string;      // bu dönemin hak edişinden henüz tahsil edilmemiş tutar
                            // (paket-dışı tamamlanmış ders + ürün satışı kalan alacağı)
  current: boolean;         // içinde bulunulan (kısmi) dönem mi
};

export type FinanceFlowPeriod = {
  cashInflow: { total: string; cash: string; iban: string };
  scheduledRemaining: string; // şimdi → dönem sonu arası planlı (scheduled) ders
  prevEarnings: string;       // önceki dönemde "aynı günlere kadar" kazanç
  sources: { single: string; package: string; product: string };
  series: FinanceFlowSeriesPoint[];
};

export type FinanceFlowResult = {
  today: string; // 'YYYY-MM-DD' (Istanbul)
  week: FinanceFlowPeriod;
  month: FinanceFlowPeriod;
};

type Unit = "week" | "month";

// Dönem birimine göre serideki kova sayısı ve adım aralıkları. `unit` sabittir
// (kullanıcı girdisi değil), bu yüzden SQL'e doğrudan gömmek güvenlidir.
function unitParts(unit: Unit) {
  return unit === "week"
    ? { step: "INTERVAL '7 days'", back: "INTERVAL '7 days'", span: "INTERVAL '7 weeks'", gsStep: "INTERVAL '1 week'" }
    : { step: "INTERVAL '1 month'", back: "INTERVAL '1 month'", span: "INTERVAL '5 months'", gsStep: "INTERVAL '1 month'" };
}

// Grafik serisi: son N kova (hafta: 8, ay: 6), eskiden yeniye. Her kovada
// ders neti, ürün toplamı ve tamamlanmış ders adedi. Tek ders × tek satış
// fanout'unu önlemek için kova başına skaler alt sorgular kullanılır.
function seriesSql(unit: Unit): string {
  const { step, span, gsStep } = unitParts(unit);
  return `
    WITH buckets AS (
      SELECT
        gs                                            AS b_wall,
        (gs AT TIME ZONE 'Europe/Istanbul')           AS b_start,
        ((gs + ${step}) AT TIME ZONE 'Europe/Istanbul') AS b_end
      FROM generate_series(
        date_trunc('${unit}', (now() AT TIME ZONE 'Europe/Istanbul')) - ${span},
        date_trunc('${unit}', (now() AT TIME ZONE 'Europe/Istanbul')),
        ${gsStep}
      ) AS gs
    )
    SELECT
      to_char(b.b_wall, 'YYYY-MM-DD') AS start,
      (SELECT COALESCE(SUM(l.price_snapshot - l.discount_amount), 0)
         FROM lessons l
         WHERE l.status = 'completed' AND l.deleted_at IS NULL
           AND l.starts_at >= b.b_start AND l.starts_at < b.b_end)::text AS lesson,
      (SELECT COALESCE(SUM(ps.total_amount), 0)
         FROM product_sales ps
         WHERE ps.deleted_at IS NULL
           AND ps.sold_at >= b.b_start AND ps.sold_at < b.b_end)::text AS product,
      (SELECT COUNT(*)
         FROM lessons l
         WHERE l.status = 'completed' AND l.deleted_at IS NULL
           AND l.starts_at >= b.b_start AND l.starts_at < b.b_end)::text AS completed_lessons,
      (SELECT COALESCE(SUM(p.amount), 0)
         FROM payments p
         WHERE p.deleted_at IS NULL AND p.source IN ('cash', 'iban')
           AND p.paid_at >= b.b_start AND p.paid_at < b.b_end)::text AS cash_total,
      (SELECT COALESCE(SUM(p.amount), 0)
         FROM payments p
         WHERE p.deleted_at IS NULL AND p.source = 'cash'
           AND p.paid_at >= b.b_start AND p.paid_at < b.b_end)::text AS cash_cash,
      (SELECT COALESCE(SUM(p.amount), 0)
         FROM payments p
         WHERE p.deleted_at IS NULL AND p.source = 'iban'
           AND p.paid_at >= b.b_start AND p.paid_at < b.b_end)::text AS cash_iban,
      (
        (SELECT COALESCE(SUM(lb.remaining_receivable), 0)
           FROM v_lesson_balances lb
           WHERE lb.status = 'completed' AND lb.prepaid_package_id IS NULL
             AND lb.starts_at >= b.b_start AND lb.starts_at < b.b_end)
        +
        (SELECT COALESCE(SUM(pb.remaining_receivable), 0)
           FROM v_product_sale_balances pb
           WHERE pb.sold_at >= b.b_start AND pb.sold_at < b.b_end)
      )::text AS outstanding,
      (b.b_wall = date_trunc('${unit}', (now() AT TIME ZONE 'Europe/Istanbul'))) AS is_current
    FROM buckets b
    ORDER BY b.b_wall
  `;
}

// İçinde bulunulan dönemin özeti: kasa girişi (nakit/IBAN), planlı ders,
// önceki-dönem (aynı günlere kadar) kazanç ve kaynak dökümü — tek satır.
// `withToday` yalnız hafta sorgusunda true; istemcinin başlık tarihleri için
// Istanbul "bugün"ünü aynı round-trip'te döndürür.
function summarySql(unit: Unit, withToday: boolean): string {
  const { step, back } = unitParts(unit);
  const trunc = `date_trunc('${unit}', (now() AT TIME ZONE 'Europe/Istanbul'))`;
  return `
    WITH b AS (
      SELECT
        (${trunc} AT TIME ZONE 'Europe/Istanbul')              AS p_start,
        ((${trunc} + ${step}) AT TIME ZONE 'Europe/Istanbul')  AS p_end,
        ((${trunc} - ${back}) AT TIME ZONE 'Europe/Istanbul')  AS prev_start,
        (now() - ${back})                                      AS prev_cut,
        now()                                                  AS now_ts
    )
    SELECT
      ${withToday ? "to_char((now() AT TIME ZONE 'Europe/Istanbul'), 'YYYY-MM-DD') AS today," : ""}
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p, b
         WHERE p.paid_at >= b.p_start AND p.paid_at < b.p_end
           AND p.source IN ('cash', 'iban') AND p.deleted_at IS NULL)::text AS cash_total,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p, b
         WHERE p.paid_at >= b.p_start AND p.paid_at < b.p_end
           AND p.source = 'cash' AND p.deleted_at IS NULL)::text AS cash_cash,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p, b
         WHERE p.paid_at >= b.p_start AND p.paid_at < b.p_end
           AND p.source = 'iban' AND p.deleted_at IS NULL)::text AS cash_iban,
      (SELECT COUNT(*) FROM lessons l, b
         WHERE l.status = 'scheduled' AND l.deleted_at IS NULL
           AND l.starts_at >= b.now_ts AND l.starts_at < b.p_end)::text AS scheduled_remaining,
      (
        (SELECT COALESCE(SUM(l.price_snapshot - l.discount_amount), 0) FROM lessons l, b
           WHERE l.status = 'completed' AND l.deleted_at IS NULL
             AND l.starts_at >= b.prev_start AND l.starts_at < b.prev_cut)
        +
        (SELECT COALESCE(SUM(ps.total_amount), 0) FROM product_sales ps, b
           WHERE ps.deleted_at IS NULL
             AND ps.sold_at >= b.prev_start AND ps.sold_at < b.prev_cut)
      )::text AS prev_earnings,
      (SELECT COALESCE(SUM(l.price_snapshot - l.discount_amount), 0) FROM lessons l, b
         WHERE l.status = 'completed' AND l.deleted_at IS NULL AND l.prepaid_package_id IS NULL
           AND l.starts_at >= b.p_start AND l.starts_at < b.p_end)::text AS src_single,
      (SELECT COALESCE(SUM(l.price_snapshot - l.discount_amount), 0) FROM lessons l, b
         WHERE l.status = 'completed' AND l.deleted_at IS NULL AND l.prepaid_package_id IS NOT NULL
           AND l.starts_at >= b.p_start AND l.starts_at < b.p_end)::text AS src_package,
      (SELECT COALESCE(SUM(ps.total_amount), 0) FROM product_sales ps, b
         WHERE ps.deleted_at IS NULL
           AND ps.sold_at >= b.p_start AND ps.sold_at < b.p_end)::text AS src_product
  `;
}

function mapSeries(rows: Record<string, unknown>[]): FinanceFlowSeriesPoint[] {
  return rows.map((r) => ({
    start: String(r["start"]),
    lesson: String(r["lesson"]),
    product: String(r["product"]),
    completedLessons: String(r["completed_lessons"]),
    cashTotal: String(r["cash_total"]),
    cashCash: String(r["cash_cash"]),
    cashIban: String(r["cash_iban"]),
    outstanding: String(r["outstanding"]),
    current: r["is_current"] === true || r["is_current"] === "t",
  }));
}

function mapSummary(r: Record<string, unknown>): Omit<FinanceFlowPeriod, "series"> {
  return {
    cashInflow: {
      total: String(r["cash_total"]),
      cash: String(r["cash_cash"]),
      iban: String(r["cash_iban"]),
    },
    scheduledRemaining: String(r["scheduled_remaining"]),
    prevEarnings: String(r["prev_earnings"]),
    sources: {
      single: String(r["src_single"]),
      package: String(r["src_package"]),
      product: String(r["src_product"]),
    },
  };
}

export async function getFinanceFlow(): Promise<FinanceFlowResult> {
  const [weekSeries, monthSeries, weekSum, monthSum] = await Promise.all([
    pool.query(seriesSql("week")),
    pool.query(seriesSql("month")),
    pool.query(summarySql("week", true)),
    pool.query(summarySql("month", false)),
  ]);

  const weekSumRow = weekSum.rows[0] as Record<string, unknown> | undefined;
  const monthSumRow = monthSum.rows[0] as Record<string, unknown> | undefined;
  if (!weekSumRow || !monthSumRow) {
    throw new Error("Finans akış sorgusu sonuç döndürmedi");
  }

  return {
    today: String(weekSumRow["today"]),
    week: { ...mapSummary(weekSumRow), series: mapSeries(weekSeries.rows) },
    month: { ...mapSummary(monthSumRow), series: mapSeries(monthSeries.rows) },
  };
}

// ─── Doluluk · Yoklama (B2-D2) ───────────────────────────────────────────────
// Mobil "Doluluk" ekranı için yapısal veri. Hafta ve Ay iki dönem; her dönemde
// % doluluk zaman serisi (grafik) + dönem başına planlı/tamamlanan/iptal sayısı
// ve ders cirosu. Ayrıca dönemden bağımsız "temposu düşenler" yoklama tablosu
// (son 6 hafta). Para birimi yalnız TRY; tüm sayılar ::text döner, istemci
// Number() ile ayrıştırır ve Türkçe metinleri kendisi kurar.
//
// Tanımlar (ana sayfa doluluk pill'i ve §4.4 ile tutarlı):
//   - planlı (planned) ders = status IN ('scheduled','completed','no_show').
//     İptal (cancelled) doluluğa SAYILMAZ; ana sayfadaki occupancyRatio ile aynı.
//   - Hafta % doluluk  = planlı / haftalık_kapasite.
//   - Ay % doluluk     = planlı / (haftalık_kapasite × aydaki hafta sayısı),
//     yani "haftalık ortalama doluluk" (aydaki gün / 7 hafta).
//   - Ders cirosu      = dönem içi tamamlanmış ders neti (price_snapshot − discount).
//   - Öğrenci iptali    = dönem içi cancelled ders adedi (iptal eden aktör kolonu
//     yok; tek eğitmenli stüdyoda iptaller öğrenci kaynaklı sayılır).
//   - Temposu düşenler  = son 6 haftada ≥1 ders tamamlamış ama (≥1 kaçırma VEYA
//     son tamamlanan ders ≥2 hafta önce) olan öğrenciler; yoklama ızgarasıyla.

export type OccupancyBucket = {
  start: string;     // 'YYYY-MM-DD' (Istanbul) — dönem başlangıcı
  planned: string;   // planlı ders adedi (scheduled+completed+no_show)
  completed: string; // tamamlanmış ders adedi
  cancelled: string; // iptal edilen ders adedi
  revenue: string;   // tamamlanmış ders neti (ders cirosu)
  pct: string;       // % doluluk (0..) — kapasite yoksa 0
  current: boolean;  // içinde bulunulan (kısmi) dönem mi
};

export type OccupancyRosterRow = {
  name: string;      // öğrenci adı
  slot: string;      // düzenli slot — "Cumartesi 11.00" (en güncel dersten)
  att: number[];     // 6 hafta yoklama: 1=geldi 0=kaçırdı 2=planlı 3=ders yok
};

export type OccupancyFlowResult = {
  today: string;             // 'YYYY-MM-DD' (Istanbul)
  capacity: string | null;   // haftalık ders kapasitesi (studio_settings)
  week: { series: OccupancyBucket[] };
  month: { series: OccupancyBucket[] };
  roster: OccupancyRosterRow[]; // temposu düşenler (en çok 5), son 6 haftaya hizalı
};

type OccUnit = "week" | "month";

// Dönem birimine göre kova adımı/aralığı ve "kovadaki hafta sayısı" (ay için
// aydaki gün / 7; hafta için 1). `unit` sabittir, SQL'e gömmek güvenlidir.
function occUnitParts(unit: OccUnit) {
  return unit === "week"
    ? {
        step: "INTERVAL '7 days'",
        span: "INTERVAL '7 weeks'",
        gsStep: "INTERVAL '1 week'",
        weeksExpr: "1",
      }
    : {
        step: "INTERVAL '1 month'",
        span: "INTERVAL '5 months'",
        gsStep: "INTERVAL '1 month'",
        weeksExpr: "(EXTRACT(DAY FROM (b.b_wall + INTERVAL '1 month' - INTERVAL '1 day'))::numeric / 7.0)",
      };
}

// % doluluk zaman serisi: son N kova (hafta 8, ay 6), eskiden yeniye. Kova başına
// skaler alt sorgular (ders × satır fanout'unu önlemek için). pct dış sorguda
// kapasiteye bölünerek yuvarlanır.
function occSeriesSql(unit: OccUnit): string {
  const { step, span, gsStep, weeksExpr } = occUnitParts(unit);
  const trunc = `date_trunc('${unit}', (now() AT TIME ZONE 'Europe/Istanbul'))`;
  return `
    WITH buckets AS (
      SELECT
        gs                                              AS b_wall,
        (gs AT TIME ZONE 'Europe/Istanbul')             AS b_start,
        ((gs + ${step}) AT TIME ZONE 'Europe/Istanbul') AS b_end
      FROM generate_series(${trunc} - ${span}, ${trunc}, ${gsStep}) AS gs
    )
    SELECT
      q.start,
      q.planned::text   AS planned,
      q.completed::text  AS completed,
      q.cancelled::text  AS cancelled,
      q.revenue::text    AS revenue,
      (CASE WHEN q.wc IS NULL OR q.wc <= 0 THEN 0
            ELSE ROUND(q.planned::numeric * 100 / (q.wc * q.weeks_in_bucket))
       END)::text        AS pct,
      q.is_current
    FROM (
      SELECT
        to_char(b.b_wall, 'YYYY-MM-DD') AS start,
        (SELECT COUNT(*) FROM lessons l
           WHERE l.deleted_at IS NULL
             AND l.status IN ('scheduled', 'completed', 'no_show')
             AND l.starts_at >= b.b_start AND l.starts_at < b.b_end) AS planned,
        (SELECT COUNT(*) FROM lessons l
           WHERE l.deleted_at IS NULL AND l.status = 'completed'
             AND l.starts_at >= b.b_start AND l.starts_at < b.b_end) AS completed,
        (SELECT COUNT(*) FROM lessons l
           WHERE l.deleted_at IS NULL AND l.status = 'cancelled'
             AND l.starts_at >= b.b_start AND l.starts_at < b.b_end) AS cancelled,
        (SELECT COALESCE(SUM(l.price_snapshot - l.discount_amount), 0) FROM lessons l
           WHERE l.deleted_at IS NULL AND l.status = 'completed'
             AND l.starts_at >= b.b_start AND l.starts_at < b.b_end) AS revenue,
        (SELECT weekly_capacity::numeric FROM studio_settings WHERE id = 1) AS wc,
        ${weeksExpr} AS weeks_in_bucket,
        (b.b_wall = ${trunc}) AS is_current
      FROM buckets b
    ) q
    ORDER BY q.start
  `;
}

function mapOccSeries(rows: Record<string, unknown>[]): OccupancyBucket[] {
  return rows.map((r) => ({
    start: String(r["start"]),
    planned: String(r["planned"]),
    completed: String(r["completed"]),
    cancelled: String(r["cancelled"]),
    revenue: String(r["revenue"]),
    pct: String(r["pct"]),
    current: r["is_current"] === true || r["is_current"] === "t",
  }));
}

// Temposu düşenler için ham veri: son 6 haftadaki (5 tam + cari) tüm dersler,
// öğrenci adıyla. Yoklama ızgarası ve seçim/sıralama TypeScript'te kurulur
// (test edilebilirlik + Türkçe gün adı/slot biçimi için).
const OCC_ROSTER_SQL = `
  WITH win AS (
    SELECT
      (date_trunc('week', (now() AT TIME ZONE 'Europe/Istanbul')) - INTERVAL '5 weeks')
        AT TIME ZONE 'Europe/Istanbul' AS w_start,
      (date_trunc('week', (now() AT TIME ZONE 'Europe/Istanbul')) + INTERVAL '1 week')
        AT TIME ZONE 'Europe/Istanbul' AS w_end
  )
  SELECT
    l.student_id,
    s.full_name,
    to_char(l.starts_at AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD"T"HH24:MI') AS local_dt,
    l.status
  FROM lessons l
  JOIN students s ON s.id = l.student_id, win
  WHERE l.deleted_at IS NULL
    AND s.deleted_at IS NULL
    AND l.starts_at >= win.w_start
    AND l.starts_at <  win.w_end
  ORDER BY l.student_id, l.starts_at
`;

const OCC_META_SQL = `
  SELECT
    to_char((now() AT TIME ZONE 'Europe/Istanbul'), 'YYYY-MM-DD')                 AS today,
    to_char(date_trunc('week', (now() AT TIME ZONE 'Europe/Istanbul')), 'YYYY-MM-DD') AS this_monday,
    (SELECT weekly_capacity FROM studio_settings WHERE id = 1)::text              AS capacity
`;

const TR_DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

// 'YYYY-MM-DD' → o tarihin haftasının Pazartesi'sine olan tam gün farkından
// hafta indeksi (0..5; 5 = cari hafta). thisMonday cari haftanın Pazartesi'si.
function weekIndexOf(localDate: string, thisMonday: string): number {
  const toUTC = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
  };
  const dms = toUTC(localDate);
  const dow = (new Date(dms).getUTCDay() + 6) % 7; // Pazartesi = 0
  const lessonMonday = dms - dow * 86400000;
  const weeksAgo = Math.round((toUTC(thisMonday) - lessonMonday) / (7 * 86400000));
  return 5 - weeksAgo;
}

// status → ızgara hücresi önceliği (büyük kazanır): geldi > planlı > kaçırdı > yok.
function statusRank(status: string): number {
  if (status === "completed") return 4; // geldi
  if (status === "scheduled") return 3; // planlı
  if (status === "no_show" || status === "cancelled") return 2; // kaçırdı
  return 1; // (beklenmeyen) → yok
}
const RANK_TO_ATT: Record<number, number> = { 4: 1, 3: 2, 2: 0, 1: 3 };

function buildRoster(
  rows: Record<string, unknown>[],
  thisMonday: string,
): OccupancyRosterRow[] {
  type Acc = { name: string; ranks: number[]; lastDt: string };
  const byStudent = new Map<string, Acc>();

  for (const r of rows) {
    const id = String(r["student_id"]);
    const name = String(r["full_name"]);
    const localDt = String(r["local_dt"]); // 'YYYY-MM-DDTHH:MM'
    const status = String(r["status"]);
    const idx = weekIndexOf(localDt.slice(0, 10), thisMonday);
    if (idx < 0 || idx > 5) continue;

    let acc = byStudent.get(id);
    if (!acc) {
      acc = { name, ranks: [1, 1, 1, 1, 1, 1], lastDt: localDt };
      byStudent.set(id, acc);
    }
    acc.ranks[idx] = Math.max(acc.ranks[idx]!, statusRank(status));
    if (localDt > acc.lastDt) acc.lastDt = localDt;
  }

  const candidates = [];
  for (const acc of byStudent.values()) {
    const att = acc.ranks.map((rank) => RANK_TO_ATT[rank]!);
    const completedIdx = att.flatMap((v, i) => (v === 1 ? [i] : []));
    if (completedIdx.length === 0) continue; // son 6 haftada hiç gelmemiş → aday değil

    const lastCompleted = completedIdx[completedIdx.length - 1]!;
    const gap = 5 - lastCompleted; // kaç haftadır gelmiyor
    const misses = att.filter((v) => v === 0).length;
    if (misses < 1 && gap < 2) continue; // düzenli gelen → temposu düşmüyor

    candidates.push({ name: acc.name, slot: formatSlot(acc.lastDt), att, gap, misses });
  }

  // Dikkat önceliği: önce daha uzun boşluk, sonra daha çok kaçırma.
  candidates.sort((a, b) => b.gap - a.gap || b.misses - a.misses || a.name.localeCompare(b.name, "tr"));
  return candidates.slice(0, 5).map(({ name, slot, att }) => ({ name, slot, att }));
}

// 'YYYY-MM-DDTHH:MM' → "Cumartesi 11.00"
function formatSlot(localDt: string): string {
  const [datePart, timePart] = localDt.split("T");
  const [y, m, d] = datePart!.split("-").map(Number);
  const dow = (new Date(Date.UTC(y!, (m || 1) - 1, d || 1)).getUTCDay() + 6) % 7;
  return `${TR_DAYS[dow]} ${(timePart || "").replace(":", ".")}`;
}

export async function getOccupancyFlow(): Promise<OccupancyFlowResult> {
  const [weekSeries, monthSeries, meta, rosterRows] = await Promise.all([
    pool.query(occSeriesSql("week")),
    pool.query(occSeriesSql("month")),
    pool.query(OCC_META_SQL),
    pool.query(OCC_ROSTER_SQL),
  ]);

  const metaRow = meta.rows[0] as Record<string, unknown> | undefined;
  if (!metaRow) {
    throw new Error("Doluluk akış sorgusu sonuç döndürmedi");
  }
  const thisMonday = String(metaRow["this_monday"]);

  return {
    today: String(metaRow["today"]),
    capacity: (metaRow["capacity"] as string | null) ?? null,
    week: { series: mapOccSeries(weekSeries.rows) },
    month: { series: mapOccSeries(monthSeries.rows) },
    roster: buildRoster(rosterRows.rows, thisMonday),
  };
}
