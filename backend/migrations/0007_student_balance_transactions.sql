-- Ref: §3.7 student_balance_transactions (ledger)
-- students ve payments'a FK bağımlılığı var.

CREATE TABLE student_balance_transactions (
  id                   bigserial PRIMARY KEY,
  student_id           bigint NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  delta                numeric(10,2) NOT NULL CHECK (delta <> 0),
  currency             text NOT NULL DEFAULT 'TRY',
  type                 text NOT NULL CHECK (type IN (
                         'overpayment_credit',
                         'usage_debit',
                         'manual_adjustment',
                         'refund_debit'
                       )),
  related_payment_id   bigint REFERENCES payments(id) ON DELETE RESTRICT,
  occurred_at          timestamptz NOT NULL DEFAULT now(),
  note                 text,
  deleted_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_balance_tx_student_occurred ON student_balance_transactions (student_id, occurred_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_balance_tx_student_created ON student_balance_transactions (student_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_balance_tx_related_payment ON student_balance_transactions (related_payment_id) WHERE related_payment_id IS NOT NULL AND deleted_at IS NULL;
