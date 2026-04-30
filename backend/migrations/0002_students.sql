-- Ref: §3.2 students

CREATE TABLE students (
  id                    bigserial PRIMARY KEY,
  full_name             text NOT NULL,
  phone                 text,
  email                 text,
  birthday              date,
  joined_at             date,
  note                  text,
  default_lesson_price  numeric(10,2) NOT NULL CHECK (default_lesson_price >= 0),
  currency              text NOT NULL DEFAULT 'TRY',
  is_active             boolean NOT NULL DEFAULT true,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_students_is_active ON students (is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_students_full_name ON students (lower(full_name)) WHERE deleted_at IS NULL;
