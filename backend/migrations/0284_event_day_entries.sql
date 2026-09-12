-- Spec §11 "Etkinlik günü ekranı" (2026-09-12): etkinlik günü kapıda tutulan
-- düz giriş listesi. Eski katılımcı / ücret kalemi / tahsilat defteri
-- (0261, 0263, 0276) bu ekranda KULLANILMAZ: ön ücretler burada anlam taşımaz,
-- esas olan o gün gerçekten alınan paradır ve her satır sonradan serbestçe
-- düzenlenebilir. Bu tablo KPI / ciro / Hareketler hesaplarına karışmaz.
--
-- - student_id boş = hafif kayıt (kapıda eklenen yeni kişi; ana öğrenci
--   listesine düşmez). Öğrenci kalıcı silinirse bağ kopar (SET NULL), satır
--   kendi ad kopyasıyla kalır.
-- - phone yalnız hafif kayıtta tutulur: ulusal 10 hane, 5 ile başlar (TR cep).
-- - amount = stüdyonun eline geçen para (kartla ödeyenin restorana kendisi
--   ödediği kahvaltı payı dahil DEĞİL). Tutar > 0 ise yöntem zorunlu, 0 ise
--   yöntem yok.
-- - breakfast: none | paid_to_us (kahvaltı parası bize ödendi, restorana biz
--   öderiz) | paid_to_restaurant (restorana kendisi ödedi, bilgi amaçlı) |
--   free (bedava; restorana yine biz öderiz). paid_to_us iken tutarın
--   kahvaltı fiyatını karşılaması servis katmanında doğrulanır — fiyat
--   etkinliğin ücret kaleminden gelir.
-- - checked_at: "ödeme OK" tiki. Kilitlemez; tutar/yöntem/kahvaltı değişince
--   servis tiki kaldırır.

CREATE TABLE event_day_entries (
  id                  bigserial PRIMARY KEY,
  event_id            bigint NOT NULL REFERENCES events(id),
  student_id          bigint REFERENCES students(id) ON DELETE SET NULL,
  full_name           text NOT NULL CHECK (btrim(full_name) <> ''),
  phone               text CHECK (phone IS NULL OR phone ~ '^5[0-9]{9}$'),
  amount              numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment_method      text CHECK (payment_method IN ('cash', 'card', 'iban')),
  breakfast           text NOT NULL DEFAULT 'none'
                        CHECK (breakfast IN ('none', 'paid_to_us', 'paid_to_restaurant', 'free')),
  note                text,
  checked_at          timestamptz,
  checked_by_user_id  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id  bigint REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id  bigint REFERENCES users(id) ON DELETE SET NULL,
  deleted_by_user_id  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT event_day_entries_method_matches_amount
    CHECK ((amount > 0) = (payment_method IS NOT NULL)),
  CONSTRAINT event_day_entries_checked_pair
    CHECK (checked_at IS NOT NULL OR checked_by_user_id IS NULL)
);

-- Aynı öğrenci aynı etkinliğe iki kez yazılamaz (iki telefon aynı anda eklese
-- bile). Silinmiş satır yer tutmaz; hafif kayıtlar (student_id boş) kısıta
-- girmez.
CREATE UNIQUE INDEX event_day_entries_one_per_student_idx
  ON event_day_entries (event_id, student_id)
  WHERE deleted_at IS NULL AND student_id IS NOT NULL;

CREATE INDEX event_day_entries_event_id_idx
  ON event_day_entries (event_id)
  WHERE deleted_at IS NULL;

INSERT INTO audit_log_actions (action) VALUES
  ('event_day_entry_created'),
  ('event_day_entry_updated'),
  ('event_day_entry_deleted'),
  ('event_day_entry_restored');

INSERT INTO audit_log_entity_types (entity_type) VALUES ('event_day_entry');
