-- Lessons tablosuna multi-entity (instructor / lesson_type), duration ve discount
-- altyapısı. Test verileri tek aktif eğitmen + tek aktif ders tipine backfill
-- edilir; sonra NOT NULL + CHECK'ler kilitlenir.

ALTER TABLE lessons
  ADD COLUMN instructor_id    bigint REFERENCES instructors(id)  ON DELETE RESTRICT,
  ADD COLUMN lesson_type_id   bigint REFERENCES lesson_types(id) ON DELETE RESTRICT,
  ADD COLUMN duration_minutes integer,
  ADD COLUMN discount_amount  numeric(10,2) NOT NULL DEFAULT 0;

-- Backfill: aktif tek eğitmen/tip; duration lesson_type'ın default'undan; discount 0.
UPDATE lessons l
   SET instructor_id    = (SELECT id FROM instructors
                            WHERE is_active AND deleted_at IS NULL
                            ORDER BY id ASC LIMIT 1),
       lesson_type_id   = lt.id,
       duration_minutes = lt.default_duration_minutes
  FROM (
    SELECT id, default_duration_minutes
    FROM lesson_types
    WHERE is_active AND deleted_at IS NULL
    ORDER BY id ASC LIMIT 1
  ) lt;

ALTER TABLE lessons
  ALTER COLUMN instructor_id    SET NOT NULL,
  ALTER COLUMN lesson_type_id   SET NOT NULL,
  ALTER COLUMN duration_minutes SET NOT NULL;

ALTER TABLE lessons
  ADD CONSTRAINT chk_lessons_duration_positive
    CHECK (duration_minutes > 0 AND duration_minutes <= 240),
  -- Ref: ilke 7 (net tutar); ilke 6 (discount validation)
  ADD CONSTRAINT chk_lessons_discount_nonneg
    CHECK (discount_amount >= 0),
  ADD CONSTRAINT chk_lessons_discount_le_price
    CHECK (discount_amount <= price_snapshot),
  -- Ref: karar 3 (paket dersinde discount yasak) ve karar 5 (discount sadece non-prepaid).
  -- Paketle kapatılmış dersler kredi ile sıfırlandığı için net borç = 0; discount
  -- uygulaması anlamsız ve v_lesson_balances'ta negatif türev oluşturabilir.
  ADD CONSTRAINT chk_lessons_prepaid_no_discount
    CHECK (prepaid_package_id IS NULL OR discount_amount = 0);

CREATE INDEX idx_lessons_instructor_id  ON lessons (instructor_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_lessons_lesson_type_id ON lessons (lesson_type_id) WHERE deleted_at IS NULL;
