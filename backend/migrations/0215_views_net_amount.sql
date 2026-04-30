-- v_lesson_balances: net_amount = price_snapshot - discount_amount (karar 7)
-- remaining_receivable = net_amount - paid_amount (GREATEST 0 savunması kalır).
-- v_student_summary aynı view'dan türediği için ayrıca güncellemeye gerek yok,
-- ama bağımlılık nedeniyle önce drop, sonra recreate gerekiyor.

DROP VIEW IF EXISTS v_student_summary;
DROP VIEW IF EXISTS v_lesson_balances;

CREATE VIEW v_lesson_balances AS
SELECT
  l.id AS lesson_id,
  l.student_id,
  l.starts_at,
  l.status,
  l.price_snapshot,
  l.discount_amount,
  (l.price_snapshot - l.discount_amount) AS net_amount,
  l.prepaid_package_id,
  COALESCE(pay.paid_sum, 0) AS paid_amount,
  (l.price_snapshot - l.discount_amount) - COALESCE(pay.paid_sum, 0) AS remaining_raw,
  GREATEST(
    0,
    (l.price_snapshot - l.discount_amount) - COALESCE(pay.paid_sum, 0)
  ) AS remaining_receivable
FROM lessons l
LEFT JOIN (
  SELECT lesson_id, SUM(amount) AS paid_sum
  FROM payments
  WHERE lesson_id IS NOT NULL AND deleted_at IS NULL
  GROUP BY lesson_id
) pay ON pay.lesson_id = l.id
WHERE l.deleted_at IS NULL;

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
     WHERE student_id = s.id AND remaining_credits > 0) AS remaining_credits
FROM students s
WHERE s.deleted_at IS NULL;
