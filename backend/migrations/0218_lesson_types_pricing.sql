-- Fiyat modeli geçişi: brüt ders fiyatı artık ders türünden gelir.
-- lesson_types.default_price → createLesson sırasında price_snapshot'a kopyalanır.
-- lesson_types.currency → v1'de TRY sabit, CHECK ile zorlanır.
--
-- Backfill: mevcut studio_settings.default_lesson_price değeri tüm lesson_types
-- kayıtlarına uygulanır. Settings singleton satırı yoksa veya değer NULL ise
-- migration açık hata verir — sessizce ilerlemez.

ALTER TABLE lesson_types
  ADD COLUMN default_price numeric(10,2) CHECK (default_price >= 0),
  ADD COLUMN currency      text NOT NULL DEFAULT 'TRY' CHECK (currency = 'TRY');

DO $$
DECLARE
  v_default_price numeric(10,2);
BEGIN
  SELECT default_lesson_price INTO v_default_price
  FROM studio_settings
  WHERE id = 1;

  IF v_default_price IS NULL THEN
    RAISE EXCEPTION
      'Migration 0218 backfill failed: studio_settings.default_lesson_price is NULL or singleton row is missing. Set a valid default before running this migration.';
  END IF;

  UPDATE lesson_types SET default_price = v_default_price;
END $$;

ALTER TABLE lesson_types
  ALTER COLUMN default_price SET NOT NULL;
