-- events.service.ts (0261) event_created / event_updated / event_fee_item_created /
-- event_participant_added / event_participant_updated / event_participant_fee_updated /
-- event_participant_payment_recorded / event_vehicle_created /
-- event_participant_vehicle_assigned action'larıyla ve 'event' / 'event_fee_item' /
-- 'event_participant' / 'event_participant_fee' / 'event_vehicle' entity_type'larıyla
-- insertAuditLog çağırıyor ama bu değerler audit_logs CHECK kısıtlarında yoktu.
-- Eski migration'lar in-place düzenlenmez; bu dosya 0256/0250'deki tam listeleri
-- korur + genişletir.

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
    'calendar_event_deleted',
    'event_created',
    'event_updated',
    'event_fee_item_created',
    'event_participant_added',
    'event_participant_updated',
    'event_participant_fee_updated',
    'event_participant_payment_recorded',
    'event_vehicle_created',
    'event_participant_vehicle_assigned',
    -- Yerel dev veritabanında feature/product-sale-cancellations-and-refunds
    -- dalının (henüz main'de değil) test verisi mevcut; bu değerler o dal
    -- main'e alınana kadar kısıtı bozmasın diye korunuyor.
    'product_sale_cancelled',
    'product_sale_cancellation_voided',
    'product_sale_refund_created',
    'product_sale_refund_voided'
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
    'lesson_type_student_price',
    'instructor',
    'product',
    'settings',
    'user',
    'calendar_event',
    'event',
    'event_fee_item',
    'event_participant',
    'event_participant_fee',
    'event_vehicle',
    'product_sale_cancellation',
    'product_sale_refund'
  ));

COMMIT;
