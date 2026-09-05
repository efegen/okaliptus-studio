-- 0265, is_lesson_fee kolonunu ekledi ama yalnız SONRADAN oluşturulan etkinliklerde
-- doldurulur (istemci artık "Ders ücreti" kalemini isLessonFee:true ile gönderiyor).
-- Migration'dan ÖNCE oluşturulmuş etkinliklerin ders ücreti kalemi false kalmıştı —
-- bu yüzden UI'da hâlâ "Stüdyo karşılar" görünüyordu. Geriye dönük tek seferlik
-- düzeltme: her etkinlikte en fazla bir tane "Ders ücreti" (birebir eşleşen)
-- etiketli kalem varsa onu is_lesson_fee=true yapar.

BEGIN;

WITH lesson_rows AS (
  SELECT id, event_id,
         ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY sort_order ASC, id ASC) AS rn
    FROM event_fee_items
   WHERE label = 'Ders ücreti'
     AND is_lesson_fee = false
)
UPDATE event_fee_items i
   SET is_lesson_fee = true
  FROM lesson_rows r
 WHERE i.id = r.id AND r.rn = 1;

COMMIT;
