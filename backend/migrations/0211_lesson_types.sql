-- Multi-lesson-type altyapısı. v1'de tek aktif tip (Yoga & Meditasyon).
-- default_duration_minutes her tip için zorunlu: yeni derslerin duration_minutes
-- değeri varsayılan olarak buradan okunur.

CREATE TABLE lesson_types (
  id                        bigserial PRIMARY KEY,
  name                      text NOT NULL,
  default_duration_minutes  integer NOT NULL DEFAULT 60
                            CHECK (default_duration_minutes > 0 AND default_duration_minutes <= 240),
  is_active                 boolean NOT NULL DEFAULT true,
  deleted_at                timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER lesson_types_touch_updated_at
  BEFORE UPDATE ON lesson_types
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

INSERT INTO lesson_types (name, default_duration_minutes, is_active)
VALUES ('Yoga & Meditasyon', 60, true);
