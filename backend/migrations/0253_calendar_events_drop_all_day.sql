-- Ref: calendar_events (0249) all_day kolonuyla tasarlanmıştı ama mobil UI
-- "tüm gün" seçeneğini kaldırdı. Eski migration in-place düzenlenmez;
-- bu dosya kolonu kaldırır.
BEGIN;

ALTER TABLE calendar_events DROP COLUMN all_day;

COMMIT;
