-- Ref: Takvim planlarına katılımcı (öğrenci) ekleme (v1.5+).
--
-- Plan ↔ katılımcı ilişkisi ders mantığından TAMAMEN bağımsızdır ve öyle
-- kalmalıdır: bir öğrencinin bir plana katılımcı olması BORÇ, DERS, PAKET ya da
-- ÖDEME YARATMAZ. Yalnızca bilgilendirme amaçlı bir isim listesidir (ör. bir
-- atölye/toplantıya kimlerin çağrıldığı). lessons.student_id (tekil FK, finansal)
-- ile hiçbir kolon/kural paylaşmaz.
--
-- Silme davranışı:
--   * calendar_event_id ON DELETE CASCADE — planlar normalde soft-delete
--     (deleted_at) edilir; katılımcı satırları soft-delete'te KALIR ama plan
--     zaten listelerde filtrelendiği için görünmez. Gerçek hard-delete olursa
--     katılımcılar birlikte temizlenir.
--   * student_id ON DELETE CASCADE — öğrenci hard-delete (bkz. students.service
--     gerçek DELETE) edilince katılımcı kayıtları da otomatik gider; plan bloğu
--     korunur, yalnız o kişi listeden düşer.
BEGIN;

CREATE TABLE calendar_event_participants (
  calendar_event_id bigint NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  student_id        bigint NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (calendar_event_id, student_id)
);

-- "Bu öğrenci hangi planlara katılımcı?" sorgusu + öğrenci hard-delete
-- cascade'i için.
CREATE INDEX idx_calendar_event_participants_student
  ON calendar_event_participants (student_id);

COMMIT;
