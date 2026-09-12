-- Spec §11 "Etkinlik günü ekranı" ek kural (2026-09-13): dersle hiç ilgisi
-- olmayan, yalnız kahvaltı için gelen misafirler (öğrenci değil, etkinliğe
-- katılmıyor). Ayrı tablo açmak yerine aynı event_day_entries'e bir bayrakla
-- eklenir ki "N kişi" toplamı ve kahvaltı özet rakamları (fiş verildi/bekliyor,
-- restorana ödenecek) hiçbir ek sorgu değişikliği olmadan bunları da kapsasın
-- (COUNT(*) ve breakfast bazlı agregasyonlar zaten tüm satırları sayıyor).
--
-- - breakfast_only=true olan satır asla öğrenciye bağlanamaz (student_id NULL
--   olmalı) ve kahvaltısız olamaz (breakfast <> 'none') — böyle bir kayıt
--   açmanın tek sebebi kahvaltı.
-- - Oluşturulduktan sonra bu bayrak değiştirilemez (servis katmanında
--   zorlanır, updateEventDayEntry girişine hiç alınmaz).
-- - Kapı ekranının ana listesinde (MobileEventDay) GÖRÜNMEZ, yalnız Kahvaltı
--   listesi ekranında (MobileEventDayBreakfast) görünür.

ALTER TABLE event_day_entries
  ADD COLUMN breakfast_only boolean NOT NULL DEFAULT false;

ALTER TABLE event_day_entries
  ADD CONSTRAINT event_day_entries_breakfast_only_no_student
  CHECK (NOT breakfast_only OR student_id IS NULL);

ALTER TABLE event_day_entries
  ADD CONSTRAINT event_day_entries_breakfast_only_has_breakfast
  CHECK (NOT breakfast_only OR breakfast <> 'none');
