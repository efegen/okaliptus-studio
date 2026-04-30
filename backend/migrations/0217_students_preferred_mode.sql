-- Öğrenci başına ders tercihi: yüzyüze / online / belirtilmemiş.
-- NULL = tercih belirtilmemiş (v1 default). CreateLessonModal bu değeri okuyup
-- otomatik seçer ama kullanıcı değiştirebilir.

ALTER TABLE students
  ADD COLUMN preferred_mode text
  CHECK (preferred_mode IN ('online', 'onsite'));

DROP VIEW IF EXISTS v_student_summary;

CREATE VIEW v_student_summary AS
SELECT
  s.id,
  s.full_name,
  s.nickname,
  s.preferred_mode,
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
