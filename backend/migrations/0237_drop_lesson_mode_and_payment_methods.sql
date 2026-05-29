-- Ref: §3.1 studio_settings, §8.5 Settings ekranı.
-- "Varsayılan ders modu" (default_lesson_mode) ve "Ödeme yöntemi aç/kapa"
-- (payment_method_cash / payment_method_iban) ayarları v1 kapsamından çıkarıldı.
-- Karar gerekçesi: bu ayarlar Ayarlar ekranında hiçbir zaman yönetilemiyordu ve
-- varsayılanlarında donmuştu. Yeni dersler her zaman 'onsite' varsayılanıyla
-- açılır (operatör modalda değiştirebilir); ödeme formları her zaman hem Nakit
-- hem IBAN sunar. Bu kolonlar artık hiçbir servis veya UI tarafından okunmuyor.
-- (Tarihsel kalıntı temizliği — 0228'in default_lesson_duration drop'u ile aynı desen.)

ALTER TABLE studio_settings
  DROP COLUMN IF EXISTS default_lesson_mode,
  DROP COLUMN IF EXISTS payment_method_cash,
  DROP COLUMN IF EXISTS payment_method_iban;
