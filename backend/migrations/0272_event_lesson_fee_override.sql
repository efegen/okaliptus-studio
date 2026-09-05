-- Spec §2.3: asıl fiyat snapshot'ı korunur; §2.6: tahsilat borcu aşamaz.
-- Etkinlik defteri (0261/0263) için katılımcıya özel ders ücreti.
-- Normal lessons fiyatları etkilenmez. Yalnız öğrenciye yazılan etkinlik ders
-- ücretinde servis tarafından atanır; kahvaltı gibi maliyetler değiştirilemez.
BEGIN;

ALTER TABLE event_participant_fees
  ADD COLUMN amount_override numeric(12, 2),
  ADD CONSTRAINT chk_event_participant_fees_override
    CHECK (amount_override IS NULL OR (coverage = 'student' AND amount_override >= 0)),
  DROP CONSTRAINT chk_event_participant_fees_amount_matches_coverage;

ALTER TABLE event_participant_fees
  ADD CONSTRAINT chk_event_participant_fees_amount_matches_coverage
    CHECK (
      CASE WHEN coverage = 'student'
           THEN amount_snapshot = COALESCE(amount_override, base_amount_snapshot)
           ELSE amount_snapshot = 0
      END
    );

COMMENT ON COLUMN event_participant_fees.amount_override IS
  'Katılımcıya özel ders ücreti. NULL = asıl bedel. Ödeme alındıktan sonra değişmez; rol veya kapsam değişince ödenmemiş özel tutar sıfırlanır.';

COMMIT;
