-- Ref: §3.6 payments
-- lessons, product_sales, prepaid_packages'a FK bağımlılığı var.

CREATE TABLE payments (
  id                    bigserial PRIMARY KEY,
  paid_at               timestamptz NOT NULL,
  amount                numeric(10,2) NOT NULL CHECK (amount > 0),
  currency              text NOT NULL DEFAULT 'TRY',
  source                text NOT NULL CHECK (source IN ('cash', 'iban', 'balance')),
  lesson_id             bigint REFERENCES lessons(id) ON DELETE RESTRICT,
  product_sale_id       bigint REFERENCES product_sales(id) ON DELETE RESTRICT,
  prepaid_package_id    bigint REFERENCES prepaid_packages(id) ON DELETE RESTRICT,
  note                  text,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- XOR: tam olarak bir hedef dolu (§2.5)
  CONSTRAINT chk_payments_single_target
    CHECK (
      (CASE WHEN lesson_id IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN product_sale_id IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN prepaid_package_id IS NOT NULL THEN 1 ELSE 0 END) = 1
    ),

  -- Prepaid package payment sadece cash veya iban olabilir (§2.5)
  CONSTRAINT chk_payments_prepaid_source
    CHECK (
      prepaid_package_id IS NULL OR source IN ('cash', 'iban')
    )
);

CREATE INDEX idx_payments_lesson_id ON payments (lesson_id) WHERE lesson_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_payments_product_sale_id ON payments (product_sale_id) WHERE product_sale_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_payments_paid_at ON payments (paid_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_source ON payments (source) WHERE deleted_at IS NULL;

-- Paket başına en fazla bir aktif payment (§3.6 HARDENING)
CREATE UNIQUE INDEX ux_payments_one_active_per_package
  ON payments (prepaid_package_id)
  WHERE prepaid_package_id IS NOT NULL AND deleted_at IS NULL;
