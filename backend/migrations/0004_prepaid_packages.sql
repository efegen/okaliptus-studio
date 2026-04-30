-- Ref: §3.5 prepaid_packages
-- students'a FK bağımlılığı var.
-- lessons'dan önce gelmeli (lessons prepaid_packages'a FK verir).

CREATE TABLE prepaid_packages (
  id              bigserial PRIMARY KEY,
  student_id      bigint NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  purchased_at    timestamptz NOT NULL,
  credit_count    integer NOT NULL CHECK (credit_count > 0),
  unit_price      numeric(10,2) NOT NULL CHECK (unit_price >= 0),
  total_amount    numeric(10,2) NOT NULL CHECK (total_amount > 0),
  currency        text NOT NULL DEFAULT 'TRY',
  note            text,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Muhasebe invariant'ı: total_amount = credit_count × unit_price (§2.4)
  CONSTRAINT chk_prepaid_total_equals_credits_times_unit
    CHECK (total_amount = credit_count * unit_price)
);

CREATE INDEX idx_prepaid_packages_student_purchased_at ON prepaid_packages (student_id, purchased_at) WHERE deleted_at IS NULL;
