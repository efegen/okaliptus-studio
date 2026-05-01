-- Multi-instructor altyapısı. Tablo boş başlar; eğitmenler UI üzerinden
-- oluşturulur. Lessons FK'si sonraki migration'da eklenir.

CREATE TABLE instructors (
  id          bigserial PRIMARY KEY,
  full_name   text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER instructors_touch_updated_at
  BEFORE UPDATE ON instructors
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
