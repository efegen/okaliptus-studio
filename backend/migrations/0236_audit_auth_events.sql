-- Güvenlik denetimi: kimlik doğrulama olayları (login/logout) artık audit_logs'a
-- yazılıyor. Bunun için audit_logs CHECK kısıtları genişletilir.
--
-- action listesine 'user_login' ve 'user_logout' eklenir (0235'teki tam liste korunur).
-- entity_type listesine 'user' eklenir (0231'deki tam liste korunur).
-- Eski migration'lar in-place düzenlenmez; bu yeni numaralı dosya tam listeleri
-- yeniden üretir (eksik liste mevcut audit insert'lerini kırardı).

BEGIN;

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
    'instructor_created',
    'instructor_updated',
    'instructor_deleted',
    'product_created',
    'product_updated',
    'product_archived',
    'product_unarchived',
    'product_deleted',
    'settings_updated',
    'user_login',
    'user_logout'
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
    'instructor',
    'product',
    'settings',
    'user'
  ));

COMMIT;
