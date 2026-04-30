-- Öğrencilere opsiyonel "lakap" (nickname) alanı — ikinci tür ad gibi.
-- v_student_summary'de de yer alır ki liste ve profil ekranı tek sorguda
-- tam isim + lakap üzerinden görüntülenebilsin.

ALTER TABLE students
  ADD COLUMN nickname text;

CREATE INDEX idx_students_nickname_ci
  ON students (lower(nickname))
  WHERE deleted_at IS NULL AND nickname IS NOT NULL;

DROP VIEW IF EXISTS v_student_summary;

CREATE VIEW v_student_summary AS
SELECT
  s.id,
  s.full_name,
  s.nickname,
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
