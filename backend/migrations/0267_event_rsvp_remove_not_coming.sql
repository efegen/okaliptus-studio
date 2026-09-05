-- Ürün kararı: RSVP'de "gelmiyor" seçeneği kaldırıldı — gelmeyecek kişi artık
-- işaretlenmez, katılımcı listesinden doğrudan silinir (events.service.ts
-- removeParticipant, 'event_participant_removed' audit action'ı). "Gelmedi"
-- (no-show) ayrı bir kavram olarak kalıyor: attendance_status, deferred canlı
-- etkinlik günü ekranı içindir ve bu migration'dan etkilenmez.
--
-- rsvp_status'tan 'not_coming' tamamen çıkarılıyor (0261_events.sql üzerine,
-- eski migration in-place düzenlenmez). Önce olası eski verinin temizliği:
-- bu değerdeki satırlar silinir; onlara "misafiri" olarak bağlı biri varsa
-- (guest_of_participant_id) önce bağlantısı koparılır, yoksa FK reddeder.

BEGIN;

UPDATE event_participants SET guest_of_participant_id = NULL
 WHERE guest_of_participant_id IN (
   SELECT id FROM event_participants WHERE rsvp_status = 'not_coming'
 );

DELETE FROM event_participants WHERE rsvp_status = 'not_coming';

ALTER TABLE event_participants DROP CONSTRAINT IF EXISTS event_participants_rsvp_status_check;
ALTER TABLE event_participants ADD CONSTRAINT event_participants_rsvp_status_check
  CHECK (rsvp_status IN ('coming', 'unsure'));

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
    'event_deleted',
    'event_fee_item_created',
    'event_participant_added',
    'event_participant_updated',
    'event_participant_removed',
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

COMMIT;
