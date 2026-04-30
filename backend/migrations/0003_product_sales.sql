-- Ref: §3.4 product_sales
-- students'a FK bağımlılığı var.

CREATE TABLE product_sales (
  id             bigserial PRIMARY KEY,
  student_id     bigint NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  sold_at        timestamptz NOT NULL,
  total_amount   numeric(10,2) NOT NULL CHECK (total_amount > 0),
  currency       text NOT NULL DEFAULT 'TRY',
  note           text,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_sales_student_sold_at ON product_sales (student_id, sold_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_product_sales_sold_at ON product_sales (sold_at) WHERE deleted_at IS NULL;
