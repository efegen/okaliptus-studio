-- Ders ücreti kalemini yapısal olarak işaretler (0261_events.sql, 0263_event_fee_coverage.sql
-- üzerine). Ders ücreti stüdyonun kendi geliridir — "stüdyo karşılar" burada gerçek bir
-- masraf temsil etmez, yalnız tahsil edilmeyen bir gelirdir; bu yüzden bu kalemde
-- "stüdyo karşılar"/"kendi öder" seçenekleri servis katmanında (feeCoverage) hiç
-- sunulmaz. Kahvaltı gibi dışarıya ödenen kalemlerde bu kısıtlama YOK — is_pass_through'tan
-- bağımsız, sabit bir kural.
--
-- Etkinlik oluşturulurken UI ilk kalemi ("Ders ücreti") bu bayrakla gönderir; sonradan
-- eklenen kalemler (POST /events/:id/fee-items) her zaman false'tur.

BEGIN;

ALTER TABLE event_fee_items
  ADD COLUMN is_lesson_fee boolean NOT NULL DEFAULT false;

-- Bir etkinlikte en fazla bir "ders ücreti" kalemi olabilir.
CREATE UNIQUE INDEX event_fee_items_one_lesson_fee_idx
  ON event_fee_items(event_id)
  WHERE is_lesson_fee;

COMMENT ON COLUMN event_fee_items.is_lesson_fee IS
  'true = bu kalem dersin kendisi (stüdyonun geliri) — "stüdyo karşılar"/"kendi öder" bu kalemde sunulmaz.';

COMMIT;
