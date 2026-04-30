-- Ref: §4.8 View Önerileri
-- Tüm tablolar ve trigger'lar hazır olduktan sonra çalışır.

-- ─────────────────────────────────────────────────────────────────────────────
-- v_lesson_balances: Lesson-level açık bakiye
-- ─────────────────────────────────────────────────────────────────────────────

CREATE VIEW v_lesson_balances AS
SELECT
  l.id AS lesson_id,
  l.student_id,
  l.starts_at,
  l.status,
  l.price_snapshot,
  l.prepaid_package_id,
  COALESCE(pay.paid_sum, 0) AS paid_amount,
  l.price_snapshot - COALESCE(pay.paid_sum, 0) AS remaining_raw,
  GREATEST(0, l.price_snapshot - COALESCE(pay.paid_sum, 0)) AS remaining_receivable
FROM lessons l
LEFT JOIN (
  SELECT lesson_id, SUM(amount) AS paid_sum
  FROM payments
  WHERE lesson_id IS NOT NULL AND deleted_at IS NULL
  GROUP BY lesson_id
) pay ON pay.lesson_id = l.id
WHERE l.deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- v_product_sale_balances: Product sale açık bakiye
-- ─────────────────────────────────────────────────────────────────────────────

CREATE VIEW v_product_sale_balances AS
SELECT
  ps.id AS product_sale_id,
  ps.student_id,
  ps.sold_at,
  ps.total_amount,
  COALESCE(pay.paid_sum, 0) AS paid_amount,
  ps.total_amount - COALESCE(pay.paid_sum, 0) AS remaining_raw,
  GREATEST(0, ps.total_amount - COALESCE(pay.paid_sum, 0)) AS remaining_receivable
FROM product_sales ps
LEFT JOIN (
  SELECT product_sale_id, SUM(amount) AS paid_sum
  FROM payments
  WHERE product_sale_id IS NOT NULL AND deleted_at IS NULL
  GROUP BY product_sale_id
) pay ON pay.product_sale_id = ps.id
WHERE ps.deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- v_prepaid_package_status: Paket kullanım durumu ve kalan krediler
-- remaining_credits türetilmiş değer (§2.4): credit_count - used_count
-- ─────────────────────────────────────────────────────────────────────────────

CREATE VIEW v_prepaid_package_status AS
SELECT
  pp.id AS package_id,
  pp.student_id,
  pp.purchased_at,
  pp.credit_count,
  pp.unit_price,
  pp.total_amount,
  COALESCE(used.used_count, 0) AS used_credits,
  pp.credit_count - COALESCE(used.used_count, 0) AS remaining_credits,
  (pp.credit_count - COALESCE(used.used_count, 0)) * pp.unit_price AS remaining_value
FROM prepaid_packages pp
LEFT JOIN (
  SELECT prepaid_package_id, COUNT(*) AS used_count
  FROM lessons
  WHERE prepaid_package_id IS NOT NULL
    AND status = 'completed'
    AND deleted_at IS NULL
  GROUP BY prepaid_package_id
) used ON used.prepaid_package_id = pp.id
WHERE pp.deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- v_student_balances: Öğrenci güncel para bakiyesi (ledger SUM)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE VIEW v_student_balances AS
SELECT
  s.id AS student_id,
  s.full_name,
  COALESCE(SUM(tx.delta), 0) AS current_balance
FROM students s
LEFT JOIN student_balance_transactions tx
  ON tx.student_id = s.id AND tx.deleted_at IS NULL
WHERE s.deleted_at IS NULL
GROUP BY s.id, s.full_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- v_student_summary: Öğrenci özet kart (UI için)
-- lesson_debt + product_debt + active_credit_value + remaining_credits + current_balance
-- ─────────────────────────────────────────────────────────────────────────────

CREATE VIEW v_student_summary AS
SELECT
  s.id,
  s.full_name,
  s.is_active,
  (SELECT COALESCE(SUM(remaining_receivable), 0)
     FROM v_lesson_balances
     WHERE student_id = s.id
       AND status = 'completed'
       AND prepaid_package_id IS NULL) AS lesson_debt,
  (SELECT COALESCE(SUM(remaining_receivable), 0)
     FROM v_product_sale_balances
     WHERE student_id = s.id) AS product_debt,
  (SELECT COALESCE(SUM(remaining_value), 0)
     FROM v_prepaid_package_status
     WHERE student_id = s.id AND remaining_credits > 0) AS active_credit_value,
  (SELECT COALESCE(SUM(remaining_credits), 0)
     FROM v_prepaid_package_status
     WHERE student_id = s.id AND remaining_credits > 0) AS remaining_credits,
  (SELECT COALESCE(SUM(delta), 0)
     FROM student_balance_transactions
     WHERE student_id = s.id AND deleted_at IS NULL) AS current_balance
FROM students s
WHERE s.deleted_at IS NULL;
