-- Spec §11 "Etkinlik günü ekranı" ek kural (2026-09-13): "Restorana kendi
-- öder" (paid_to_restaurant) kapıda yalnız bir NİYET/anlaşmadır — o an
-- kahvaltı verilmiş sayılmaz. Gerçek akış: kişi gidip restorana kendi öder,
-- fişini bize gösterir, biz de karşılığında kahvaltı fişi veririz. Bu iki
-- adım (kayıt ↔ fiş kontrolü) ayrı anlarda olabileceği için ayrı bir alanda
-- tutulur — "ödeme OK" tikinden (checked_at, kasadaki paranın kontrolü)
-- bağımsızdır ve yalnız 'paid_to_restaurant' kahvaltısında anlam taşır.
-- "Bize ödedi" ve "Bedava" kahvaltılarda bekleyecek bir şey yok, kayıt anında
-- zaten verilmiş sayılır — bu alan onlarda hep boş kalır.

ALTER TABLE event_day_entries
  ADD COLUMN breakfast_confirmed_at         timestamptz,
  ADD COLUMN breakfast_confirmed_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE event_day_entries
  ADD CONSTRAINT event_day_entries_breakfast_confirm_scope
  CHECK (breakfast_confirmed_at IS NULL OR breakfast = 'paid_to_restaurant');

ALTER TABLE event_day_entries
  ADD CONSTRAINT event_day_entries_breakfast_confirm_pair
  CHECK (breakfast_confirmed_at IS NOT NULL OR breakfast_confirmed_by_user_id IS NULL);
