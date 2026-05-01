-- studio_settings.default_lesson_duration kolonunu kaldırır.
-- Kalıntı kolon: hiçbir runtime kodu okumuyordu; ders süresi her zaman
-- lesson_types.default_duration_minutes üzerinden geliyor. UI tarafındaki
-- "Varsayılan ders süresi" satırı da kaldırıldı.

ALTER TABLE studio_settings DROP COLUMN IF EXISTS default_lesson_duration;
