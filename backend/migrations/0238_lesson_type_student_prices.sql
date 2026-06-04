-- Ref: §3.4 lesson_types fiyatlandırma, §3.5 lessons price_snapshot.
-- Öğrenciye özel (sabit) ders fiyatı: bazı öğrenciler belirli ders türlerini
-- ücretsiz (custom_price = 0) veya farklı bir sabit fiyata alır. Override
-- (öğrenci × ders türü) bazındadır; bir ders türünün varsayılan fiyatını
-- (lesson_types.default_price) o öğrenci için ezer.
--
-- Çözümleme: createLesson anında price_snapshot bu override'dan (varsa)
-- kopyalanır; yoksa default_price kullanılır. Tamamlanmış ders snapshot'ı
-- asla otomatik değişmez (snapshot invariantı korunur). Paket kredisi yine
-- öncelikli kalır (completeLesson'da unit_price override eder).
--
-- ON DELETE CASCADE: bu kayıt geçmiş finansal kayıt değil, ileriye dönük bir
-- ayardır (fiyat zaten ilgili derslerde dondu). Öğrenci hard-delete edilince
-- override'ları otomatik silinir; hardDeleteStudent'a ek adım gerekmez.

CREATE TABLE lesson_type_student_prices (
  lesson_type_id bigint        NOT NULL REFERENCES lesson_types(id) ON DELETE CASCADE,
  student_id     bigint        NOT NULL REFERENCES students(id)     ON DELETE CASCADE,
  custom_price   numeric(10,2) NOT NULL CHECK (custom_price >= 0),
  currency       text          NOT NULL DEFAULT 'TRY' CHECK (currency = 'TRY'),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_type_id, student_id)
);

CREATE INDEX idx_ltsp_student ON lesson_type_student_prices (student_id);

CREATE TRIGGER lesson_type_student_prices_touch_updated_at
  BEFORE UPDATE ON lesson_type_student_prices
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
