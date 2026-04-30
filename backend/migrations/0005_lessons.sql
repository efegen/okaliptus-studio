-- Ref: §3.3 lessons
-- students ve prepaid_packages'a FK bağımlılığı var.

CREATE TABLE lessons (
  id                   bigserial PRIMARY KEY,
  student_id           bigint NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  starts_at            timestamptz NOT NULL,
  completed_at         timestamptz,
  mode                 text NOT NULL CHECK (mode IN ('online', 'onsite')),
  status               text NOT NULL CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  price_snapshot       numeric(10,2) NOT NULL CHECK (price_snapshot >= 0),
  currency             text NOT NULL DEFAULT 'TRY',
  prepaid_package_id   bigint REFERENCES prepaid_packages(id) ON DELETE RESTRICT,
  note                 text,
  deleted_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- Kredi ile karşılanan ders sadece completed olabilir (§2.4)
  CONSTRAINT chk_lessons_prepaid_only_completed
    CHECK (prepaid_package_id IS NULL OR status = 'completed'),

  -- completed ↔ completed_at iki yönlü zorunluluk (§3.3)
  CONSTRAINT chk_lessons_completed_at
    CHECK (
      (status = 'completed' AND completed_at IS NOT NULL)
      OR
      (status <> 'completed' AND completed_at IS NULL)
    )
);

CREATE INDEX idx_lessons_student_starts_at ON lessons (student_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_lessons_starts_at ON lessons (starts_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_lessons_status ON lessons (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_lessons_prepaid_package_id ON lessons (prepaid_package_id) WHERE prepaid_package_id IS NOT NULL AND deleted_at IS NULL;
