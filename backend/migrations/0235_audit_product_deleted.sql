-- v1.6 — Ürün hard-delete eklendiği için audit_logs action CHECK kısıtına
-- 'product_deleted' eklenir.
--
-- 0229'da ürünler "silinmez, arşivlenir" olarak tasarlandı. v1.6 sonrası
-- gereksinim: arşivlenmiş ürünler kalıcı silinebilsin (yalnız archived_at IS NOT NULL).
-- Geçmiş satışlar product_sale_items.name_snapshot ile bağımsız okunur kalır;
-- silme anında product_sale_items.product_id NULL'a düşürülür (FK RESTRICT'ten
-- kaçınmak için, snapshot zaten veriyi tutar).
--
-- 0231'deki action listesinin tamamı korunur; yalnız 'product_deleted' eklenir.

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
    'settings_updated'
  ));

COMMIT;
