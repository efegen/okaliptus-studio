-- Ref: spec §2.14 (Auth) — RBAC Faz 1: panelden kullanıcı yönetimi.
-- users.service.ts user_created / user_updated / user_role_changed /
-- user_password_reset / user_deactivated / user_reactivated action'larıyla
-- insertAuditLog çağırır. Eski migration'lar in-place düzenlenmez; bu dosya
-- 0252'deki tam action listesini korur + genişletir. entity_type 'user'
-- 0250'den beri mevcut — o kısıta dokunulmaz.
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
    'lesson_type_student_price_set',
    'lesson_type_student_price_removed',
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
    'user_logout',
    'user_created',
    'user_updated',
    'user_role_changed',
    'user_password_reset',
    'user_deactivated',
    'user_reactivated',
    'stock_adjusted',
    'channel_listing_changed',
    'calendar_event_created',
    'calendar_event_updated',
    'calendar_event_deleted'
  ));

COMMIT;
