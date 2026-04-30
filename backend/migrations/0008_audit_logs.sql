-- Ref: §3.8 audit_logs
-- Bağımsız tablo, diğer tablolara FK vermiyor.

CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  action        text NOT NULL CHECK (action IN (
                  'lesson_created',
                  'lesson_status_change',
                  'lesson_updated',
                  'lesson_deleted',
                  'bulk_price_update',
                  'payment_created',
                  'payment_updated',
                  'payment_deleted',
                  'product_sale_created',
                  'product_sale_updated',
                  'product_sale_deleted',
                  'prepaid_package_created',
                  'prepaid_package_deleted',
                  'balance_manual_adjustment',
                  'balance_refund',
                  'balance_overpayment_credit',
                  'balance_usage_debit',
                  'student_created',
                  'student_updated',
                  'student_deleted'
                )),
  entity_type   text NOT NULL CHECK (entity_type IN (
                  'student', 'lesson', 'product_sale',
                  'prepaid_package', 'payment', 'balance_transaction'
                )),
  entity_id     bigint NOT NULL,
  before        jsonb,
  after         jsonb,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_action ON audit_logs (action);
CREATE INDEX idx_audit_created_at ON audit_logs (created_at);
