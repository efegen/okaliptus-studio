-- Bootstrap döneminden kalan 'Efe' ve 'Default Instructor' kayıtlarını
-- soft-delete olarak işaretler. Lessons FK referansları korunur, sadece UI'da
-- görünmez ve modal/dropdown'larda seçilemez. Eğitmenler artık UI üzerinden
-- oluşturulacak.

UPDATE instructors
SET deleted_at = now()
WHERE deleted_at IS NULL
  AND full_name IN ('Efe', 'Default Instructor');
