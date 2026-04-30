-- Öğrenciye özel fiyat kavramı kaldırıldı. Brüt ders fiyatının tek kaynağı
-- artık lesson_types.default_price (0218). Öğrenciye özel durumlar discount
-- akışıyla modellenir.
--
-- Not: createLesson artık bu kolonu okumuyor (lessons.service.ts güncellendi)
-- ve student_updated audit loglarındaki geçmiş default_lesson_price alanı
-- JSON içinde kalacak — audit trail tamlığı için bilinçli.

ALTER TABLE students DROP COLUMN default_lesson_price;
