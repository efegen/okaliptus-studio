-- product_sales artık opsiyonel olarak bir derse bağlanabilir. Ders tamamlama
-- akışında oluşturulan satışlar bu sütun üzerinden ilgili derse bağlanır;
-- bağımsız (kişi sadece alışveriş yaptı) satışlarda NULL kalır.
--
-- ON DELETE RESTRICT: derslerde hard delete kullanılmıyor (soft delete var),
-- bu yüzden RESTRICT pratikte sadece bir güvenlik şeridi. Soft delete tarafında
-- ekstra kontrolü application layer'da (softDeleteLesson) yapıyoruz.
--
-- (student_id, lesson_id) tutarlılığı: aynı satış başka bir öğrencinin dersine
-- bağlanamaz. Application layer'da zorlanıyor (createProductSale validation).

ALTER TABLE product_sales
  ADD COLUMN lesson_id bigint NULL REFERENCES lessons(id) ON DELETE RESTRICT;

CREATE INDEX idx_product_sales_lesson_id
  ON product_sales (lesson_id)
  WHERE lesson_id IS NOT NULL AND deleted_at IS NULL;

-- v_product_sale_balances: lesson_id'yi de yansıt ki öğrenci profili / takvim
-- entegrasyonu view üzerinden okuyabilsin. CREATE OR REPLACE VIEW yeni sütunu
-- yalnızca sona ekleyebildiği için lesson_id en sonda — sütun sırası dışında
-- mevcut tüketicilerin (v_student_summary vb.) kontratı bozulmaz.
CREATE OR REPLACE VIEW v_product_sale_balances AS
SELECT
  ps.id AS product_sale_id,
  ps.student_id,
  ps.sold_at,
  ps.total_amount,
  COALESCE(pay.paid_sum, 0) AS paid_amount,
  ps.total_amount - COALESCE(pay.paid_sum, 0) AS remaining_raw,
  GREATEST(0, ps.total_amount - COALESCE(pay.paid_sum, 0)) AS remaining_receivable,
  ps.lesson_id
FROM product_sales ps
LEFT JOIN (
  SELECT product_sale_id, SUM(amount) AS paid_sum
  FROM payments
  WHERE product_sale_id IS NOT NULL AND deleted_at IS NULL
  GROUP BY product_sale_id
) pay ON pay.product_sale_id = ps.id
WHERE ps.deleted_at IS NULL;
