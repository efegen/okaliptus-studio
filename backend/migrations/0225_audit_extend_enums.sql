-- audit_logs: action ve entity_type CHECK kısıtlarını genişlet.
-- Yeni action'lar: lesson_uncompleted (ders geri alma), lesson_type_created/updated,
-- settings_updated. Yeni entity_type'lar: lesson_type, settings.

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_action_check
  CHECK (action IN (
    'lesson_created',
    'lesson_status_change',
    'lesson_uncompleted',
    'lesson_updated',
    'lesson_deleted',
    'lesson_discount_updated',
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
    'student_deleted',
    'lesson_type_created',
    'lesson_type_updated',
    'settings_updated'
  ));

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entity_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_entity_type_check
  CHECK (entity_type IN (
    'student',
    'lesson',
    'product_sale',
    'prepaid_package',
    'payment',
    'balance_transaction',
    'lesson_type',
    'settings'
  ));
