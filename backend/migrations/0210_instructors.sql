-- Multi-instructor altyapısı. v1'de tek aktif eğitmen seed'lenir; gerçek
-- eğitmen ismi (PII) bu migration'da hardcoded değildir, bootstrap script
-- (.env'den okuyarak) deploy zamanında günceller.
-- Lessons FK'si sonraki migration'da eklenir.

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

-- Placeholder seed: bootstrap aşamasında gerçek isim ile UPDATE edilir.
-- "createLesson No active instructor" hatasını engellemek için en az 1
-- aktif satır gerekli; placeholder değer hiçbir UI'da görünmez (operatör
-- bootstrap'ı atlamadıkça).
INSERT INTO instructors (full_name, is_active)
VALUES ('Default Instructor', true);
