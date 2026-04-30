-- Remove the overpayment / balance ledger feature entirely.
--
-- Drops:
--   - student_balance_transactions (test data included, intentional)
--   - v_student_balances (only ever summed from that table)
--   - references to current_balance in v_student_summary
--
-- Narrows:
--   - payments.source is now 'cash' | 'iban' (no 'balance' mahsup)

-- Views that reference the ledger must go first.
DROP VIEW IF EXISTS v_student_summary;
DROP VIEW IF EXISTS v_student_balances;

DROP TABLE IF EXISTS student_balance_transactions;

-- Narrow the payments.source CHECK constraint. The existing constraint is
-- anonymous ("payments_source_check" is postgres's default name) so we drop
-- by the well-known default identifier. Any existing 'balance' payments would
-- fail the new constraint — we purge them first. Only soft-deleted rows are
-- expected (the overpayment/mahsup code paths were the only way to create them
-- and always soft-deleted on rollback); hard-deleting is safe because they
-- have been excluded from all views/queries since the feature was removed.
DELETE FROM payments WHERE source NOT IN ('cash', 'iban');

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_source_check;
ALTER TABLE payments ADD CONSTRAINT payments_source_check
  CHECK (source IN ('cash', 'iban'));

-- Purge balance-related audit log rows so the tightened CHECK constraint below
-- can apply cleanly. Test-data only; no production history to preserve.
DELETE FROM audit_logs
 WHERE action IN (
         'balance_manual_adjustment',
         'balance_refund',
         'balance_overpayment_credit',
         'balance_usage_debit'
       )
    OR entity_type = 'balance_transaction';

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_action_check
  CHECK (action IN (
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
    'student_created',
    'student_updated',
    'student_deleted'
  ));

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entity_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_entity_type_check
  CHECK (entity_type IN (
    'student', 'lesson', 'product_sale',
    'prepaid_package', 'payment'
  ));

-- Recreate v_student_summary without current_balance.
CREATE VIEW v_student_summary AS
SELECT
  s.id,
  s.full_name,
  s.is_active,
  (SELECT COALESCE(SUM(remaining_receivable), 0)
     FROM v_lesson_balances
     WHERE student_id = s.id
       AND status = 'completed'
       AND prepaid_package_id IS NULL) AS lesson_debt,
  (SELECT COALESCE(SUM(remaining_receivable), 0)
     FROM v_product_sale_balances
     WHERE student_id = s.id) AS product_debt,
  (SELECT COALESCE(SUM(remaining_value), 0)
     FROM v_prepaid_package_status
     WHERE student_id = s.id AND remaining_credits > 0) AS active_credit_value,
  (SELECT COALESCE(SUM(remaining_credits), 0)
     FROM v_prepaid_package_status
     WHERE student_id = s.id AND remaining_credits > 0) AS remaining_credits
FROM students s
WHERE s.deleted_at IS NULL;
