// Ref: §8.3 movements — stüdyo geneli "Hareketler" akışı.
//
// Tüm öğrencilerin ürün satışları, gerçekleşmiş dersleri (completed / cancelled /
// no_show) ve tahsilatlarını (ödeme) tek bir kronolojik listede toplar. Öğrenci
// profilindeki listStudentMovements'ın (students.service.ts) stüdyo-geneli
// kardeşi: tek öğrenci filtresi yerine her satıra öğrenci adı join'lenir.
// Borç evrimi / yürüyen bakiye YOK — her satır bağımsız bir olaydır.

import { pool } from "../db/connection.js";
import { toServiceError } from "./errors.js";

export type StudioMovementKind =
  | "product_sale"
  | "lesson_completed"
  | "lesson_cancelled"
  | "lesson_no_show"
  | "payment";

export type StudioMovementTypeFilter = "all" | "sale" | "lesson" | "payment";

export type StudioMovementRow = {
  id: string;
  occurred_at: string;
  kind: StudioMovementKind;
  student_id: string;
  student_name: string;
  details: Record<string, unknown>;
};

export type StudioMovementsSummary = {
  sales_count: number;
  lessons_count: number;
  completed_count: number;
  payments_count: number;
  sales_total: string;
  payments_total: string;
};

export type ListStudioMovementsParams = {
  from?: string | null;
  to?: string | null;
  type?: StudioMovementTypeFilter;
  q?: string | null;
  limit?: number;
  offset?: number;
};

export type ListStudioMovementsResult = {
  data: StudioMovementRow[];
  hasMore: boolean;
  summary: StudioMovementsSummary;
};

// Üç olay türünü tek şemaya indiren UNION. occurred_at seçimi:
//   - ürün satışı     → sold_at
//   - tamamlanan ders → completed_at
//   - iptal / gelmedi → updated_at (özel timestamp yok; en iyi yaklaşıklık —
//     listStudentMovements ile aynı kural)
//   - ödeme           → paid_at
// Soft-delete'li satırlar her dalda dışlanır. Ödeme satırının öğrencisi XOR
// hedeften (ders / ürün satışı / paket) COALESCE ile çözülür; tek bağı
// soft-delete'liyse satır düşer (istenen davranış: ortada öğrenci kalmaz).
const EVENTS_SQL = `
  -- Ürün satışları
  SELECT
    ('sale-' || ps.id::text)            AS id,
    ps.sold_at                          AS occurred_at,
    'product_sale'::text                AS kind,
    ps.student_id::text                 AS student_id,
    st.full_name                        AS student_name,
    jsonb_build_object(
      'sale_id',              ps.id::text,
      'total_amount',         ps.total_amount,
      'paid_amount',          b.paid_amount,
      'remaining_receivable', b.remaining_receivable,
      'note',                 ps.note
    )                                   AS details
  FROM product_sales ps
  JOIN students st ON st.id = ps.student_id AND st.deleted_at IS NULL
  LEFT JOIN v_product_sale_balances b ON b.product_sale_id = ps.id
  WHERE ps.deleted_at IS NULL

  UNION ALL

  -- Gerçekleşmiş dersler (completed / cancelled / no_show)
  SELECT
    ('lesson-' || l.id::text),
    COALESCE(l.completed_at, l.updated_at),
    ('lesson_' || l.status),
    l.student_id::text,
    st.full_name,
    jsonb_build_object(
      'status',               l.status,
      'mode',                 l.mode,
      'starts_at',            l.starts_at,
      'price_snapshot',       l.price_snapshot,
      'net_amount',           b.net_amount,
      'paid_amount',          b.paid_amount,
      'remaining_receivable', b.remaining_receivable,
      'prepaid_package_id',   l.prepaid_package_id,
      'note',                 l.note
    )
  FROM lessons l
  JOIN students st ON st.id = l.student_id AND st.deleted_at IS NULL
  LEFT JOIN v_lesson_balances b ON b.lesson_id = l.id
  WHERE l.deleted_at IS NULL
    AND l.status IN ('completed', 'cancelled', 'no_show')

  UNION ALL

  -- Tahsilatlar (ödemeler)
  SELECT
    ('pay-' || pay.id::text),
    pay.paid_at,
    'payment'::text,
    st.id::text,
    st.full_name,
    jsonb_build_object(
      'amount',           pay.amount,
      'source',           pay.source,
      'target',           CASE
                            WHEN pay.lesson_id IS NOT NULL       THEN 'lesson'
                            WHEN pay.product_sale_id IS NOT NULL THEN 'product_sale'
                            ELSE                                      'package'
                          END,
      'lesson_starts_at', l.starts_at,
      'lesson_mode',      l.mode,
      'note',             pay.note
    )
  FROM payments pay
  LEFT JOIN lessons          l  ON l.id  = pay.lesson_id          AND l.deleted_at IS NULL
  LEFT JOIN product_sales    ps ON ps.id = pay.product_sale_id    AND ps.deleted_at IS NULL
  LEFT JOIN prepaid_packages pp ON pp.id = pay.prepaid_package_id AND pp.deleted_at IS NULL
  JOIN students st ON st.id = COALESCE(l.student_id, ps.student_id, pp.student_id)
                  AND st.deleted_at IS NULL
  WHERE pay.deleted_at IS NULL
`;

const DATA_SQL = `
  SELECT id, occurred_at, kind, student_id, student_name, details
  FROM ( ${EVENTS_SQL} ) events
  WHERE ($1::timestamptz IS NULL OR occurred_at >= $1)
    AND ($2::timestamptz IS NULL OR occurred_at <  $2)
    AND (
      $3 = 'all'
      OR ($3 = 'sale'    AND kind = 'product_sale')
      OR ($3 = 'lesson'  AND kind IN ('lesson_completed', 'lesson_cancelled', 'lesson_no_show'))
      OR ($3 = 'payment' AND kind = 'payment')
    )
    AND ($4::text IS NULL OR student_name ILIKE $4)
  ORDER BY occurred_at DESC, id DESC
  LIMIT $5 OFFSET $6
`;

// Özet, tarih + arama filtresine uyar ama TÜR filtresine uymaz: böylece tür
// chip'leri o aralık için sabit sayıları gösterir (Satış/Ders/Tahsilat adedi).
const SUMMARY_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE kind = 'product_sale')::int AS sales_count,
    COUNT(*) FILTER (WHERE kind IN ('lesson_completed', 'lesson_cancelled', 'lesson_no_show'))::int AS lessons_count,
    COUNT(*) FILTER (WHERE kind = 'lesson_completed')::int AS completed_count,
    COUNT(*) FILTER (WHERE kind = 'payment')::int AS payments_count,
    COALESCE(SUM((details->>'total_amount')::numeric) FILTER (WHERE kind = 'product_sale'), 0)::text AS sales_total,
    COALESCE(SUM((details->>'amount')::numeric)       FILTER (WHERE kind = 'payment'), 0)::text       AS payments_total
  FROM ( ${EVENTS_SQL} ) events
  WHERE ($1::timestamptz IS NULL OR occurred_at >= $1)
    AND ($2::timestamptz IS NULL OR occurred_at <  $2)
    AND ($3::text IS NULL OR student_name ILIKE $3)
`;

export async function listStudioMovements(
  params: ListStudioMovementsParams = {},
): Promise<ListStudioMovementsResult> {
  try {
    const from = params.from ?? null;
    const to = params.to ?? null;
    const type: StudioMovementTypeFilter = params.type ?? "all";
    // ILIKE'da `_` ve `%` joker karakterdir; isim aramasını birebir yapmak için
    // bunları (ve kaçış karakteri `\`) escape'liyoruz (Postgres varsayılan ESCAPE '\').
    const q = params.q && params.q.trim()
      ? `%${params.q.trim().replace(/[\\%_]/g, "\\$&")}%`
      : null;
    const limit = Math.min(Math.max(1, params.limit ?? 50), 200);
    const offset = Math.max(0, params.offset ?? 0);

    const [dataRes, sumRes] = await Promise.all([
      pool.query<StudioMovementRow>(DATA_SQL, [from, to, type, q, limit + 1, offset]),
      pool.query<StudioMovementsSummary>(SUMMARY_SQL, [from, to, q]),
    ]);

    const rows = dataRes.rows;
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const s = sumRes.rows[0];
    const summary: StudioMovementsSummary = {
      sales_count: Number(s?.sales_count ?? 0),
      lessons_count: Number(s?.lessons_count ?? 0),
      completed_count: Number(s?.completed_count ?? 0),
      payments_count: Number(s?.payments_count ?? 0),
      sales_total: s?.sales_total ?? "0",
      payments_total: s?.payments_total ?? "0",
    };

    return { data, hasMore, summary };
  } catch (err) {
    throw toServiceError(err);
  }
}
