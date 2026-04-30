-- Prepaid paketlere opsiyonel lesson_type bağlama kolonu. NULL = generic;
-- tüm ders tiplerinde harcanabilir. FIFO kredi algoritması şimdilik bu
-- kolonu filtrelemez (karar 10 & 11).

ALTER TABLE prepaid_packages
  ADD COLUMN lesson_type_id bigint REFERENCES lesson_types(id) ON DELETE RESTRICT;

CREATE INDEX idx_prepaid_packages_lesson_type_id
  ON prepaid_packages (lesson_type_id)
  WHERE lesson_type_id IS NOT NULL AND deleted_at IS NULL;
