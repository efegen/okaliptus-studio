-- Etkinlik ücret kalemlerinde "kim ödüyor" ayrımı (0261_events.sql üzerine).
--
-- 0261'de bir katılımcının kalemi ya dahildi (included=true, tam tutar) ya da
-- değildi (included=false, 0). Gerçek hayat bundan karışık: kahvaltı kalemi
-- stüdyonun geliri değil, restorana ödenecek bir geçiş kalemi. Bu yüzden
-- "kişi kalemi ALIYOR mu" (restorana verilecek kişi sayısı) ile "parasını KİM
-- ödüyor" birbirinden ayrı iki soru — included tek başına ikisini karıştırıyordu.
--
-- coverage:
--   student  → katılımcı bize öder (tek borç yaratan hal)
--   studio   → stüdyo üstlenir (davetli/gönüllü). Kişi kalemi ALIR, bedelini
--              biz karşılarız — geçiş kaleminde bu gerçek nakit yüktür.
--   comp     → tedarikçinin ücretsiz kontenjanından düşer (bkz. comp_quota).
--              Kimse ödemez, ama sınırlı bir kaynaktır.
--   external → kişi kalemi alır, parasını doğrudan tedarikçiye öder. Bize borcu
--              yok ama kişi sayısına dahildir.
--   none     → kişi bu kalemi almıyor (örn. kahvaltıya kalmıyor). Hiçbir yerde
--              sayılmaz.
--
-- amount_snapshot artık yalnızca ÖĞRENCİNİN bize borcu; base_amount_snapshot ise
-- kalemin o andaki asıl bedeli (stüdyonun üstlendiği tutar buradan okunur).
-- İkisinin tutarlılığı CHECK ile garanti altına alınır — servis katmanı hata
-- yaparsa veritabanı reddeder.

BEGIN;

-- ── event_fee_items: kontenjan + geçiş kalemi bayrağı ───────────────────────
ALTER TABLE event_fee_items
  ADD COLUMN comp_quota      integer,
  ADD COLUMN is_pass_through boolean NOT NULL DEFAULT false;

ALTER TABLE event_fee_items
  ADD CONSTRAINT chk_event_fee_items_comp_quota
    CHECK (comp_quota IS NULL OR comp_quota >= 0);

COMMENT ON COLUMN event_fee_items.comp_quota IS
  'Tedarikçinin verdiği ücretsiz kontenjan (NULL = kontenjan kavramı yok). coverage=comp satır sayısı bunu aşamaz.';
COMMENT ON COLUMN event_fee_items.is_pass_through IS
  'true = tahsil edilen para stüdyonun geliri değil, üçüncü tarafa (örn. restoran) ödenecek.';

-- ── event_participant_fees: asıl bedel snapshot''ı ─────────────────────────
ALTER TABLE event_participant_fees
  ADD COLUMN base_amount_snapshot numeric(12, 2);

-- Dahil satırlarda asıl bedel zaten amount_snapshot; hariç satırlarda kaybolmuştu,
-- kalemin güncel tutarından tamamlanır.
UPDATE event_participant_fees f
   SET base_amount_snapshot = CASE WHEN f.included THEN f.amount_snapshot ELSE i.amount END
  FROM event_fee_items i
 WHERE i.id = f.fee_item_id;

ALTER TABLE event_participant_fees
  ALTER COLUMN base_amount_snapshot SET NOT NULL,
  ADD CONSTRAINT chk_event_participant_fees_base_nonneg
    CHECK (base_amount_snapshot >= 0);

ALTER TABLE event_participant_fees
  ADD COLUMN coverage text NOT NULL DEFAULT 'student';

-- Eski davranışın karşılığı: dahil olanlar öğrenciye yazılıydı. Hariç bırakılmış
-- DAVETLİ satırları aslında "stüdyo üstleniyor" demekti (0261'de bu ayrım yoktu,
-- kişi sayısı da kaybediliyordu) — geriye dönük olarak studio'ya taşınır.
UPDATE event_participant_fees f
   SET coverage = 'studio', included = true
  FROM event_participants p
 WHERE p.id = f.participant_id AND p.role = 'invited' AND f.included = false;

UPDATE event_participant_fees
   SET coverage = 'none'
 WHERE included = false;

ALTER TABLE event_participant_fees
  ADD CONSTRAINT chk_event_participant_fees_coverage
    CHECK (coverage IN ('student', 'studio', 'comp', 'external', 'none')),
  -- included, coverage'ın türevidir: yalnız "none" kalemi kişi sayısına girmez.
  -- Eski sorgular (FILTER WHERE included) bozulmasın diye kolon korunur.
  ADD CONSTRAINT chk_event_participant_fees_included_matches_coverage
    CHECK (included = (coverage <> 'none')),
  -- Borç yalnızca coverage='student' iken oluşur ve tam olarak asıl bedeldir.
  ADD CONSTRAINT chk_event_participant_fees_amount_matches_coverage
    CHECK (
      CASE WHEN coverage = 'student'
           THEN amount_snapshot = base_amount_snapshot
           ELSE amount_snapshot = 0
      END
    );

-- Kontenjan sayımı (assertCompQuotaAvailable) sıcak yol.
CREATE INDEX event_participant_fees_comp_idx
  ON event_participant_fees(fee_item_id)
  WHERE coverage = 'comp';

COMMENT ON COLUMN event_participant_fees.coverage IS
  'student=katılımcı bize öder · studio=stüdyo üstlenir · comp=ücretsiz kontenjandan · external=doğrudan tedarikçiye öder · none=almıyor';
COMMENT ON COLUMN event_participant_fees.base_amount_snapshot IS
  'Kalemin satır açıldığı andaki asıl bedeli. Kim öderse ödesin sabittir; stüdyonun üstlendiği tutar buradan hesaplanır.';

COMMIT;
