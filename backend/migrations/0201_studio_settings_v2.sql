-- Ayarlar sayfası için studio_settings tablosuna yeni kolonlar eklenir.
-- Mevcut singleton satır (id=1) korunur; DEFAULT değerler otomatik uygulanır.

ALTER TABLE studio_settings
  ADD COLUMN IF NOT EXISTS calendar_start_hour integer NOT NULL DEFAULT 17
    CHECK (calendar_start_hour >= 0 AND calendar_start_hour < 24),
  ADD COLUMN IF NOT EXISTS calendar_end_hour integer NOT NULL DEFAULT 23
    CHECK (calendar_end_hour > 0 AND calendar_end_hour <= 24),
  ADD COLUMN IF NOT EXISTS default_lesson_duration integer NOT NULL DEFAULT 60
    CHECK (default_lesson_duration > 0 AND default_lesson_duration <= 240),
  ADD COLUMN IF NOT EXISTS default_lesson_mode text NOT NULL DEFAULT 'onsite'
    CHECK (default_lesson_mode IN ('online', 'onsite')),
  ADD COLUMN IF NOT EXISTS default_lesson_price numeric(10,2) NOT NULL DEFAULT 500
    CHECK (default_lesson_price >= 0),
  ADD COLUMN IF NOT EXISTS payment_method_cash boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_method_iban boolean NOT NULL DEFAULT true;
