-- Etkinlik "Notlar" (0268_event_notes.sql) kullanıcı isteğiyle genişletiliyor:
-- 0268'de bilinçli olarak "append-only" (yalnız ekle+listele) bırakılmıştı,
-- şimdi düzenleme, silme, yanıt ve "@" ile öğrenci bahsetme ekleniyor.
--
-- Silme soft-delete (deleted_at) — events/students/lessons ile tutarlı, audit
-- iziyle uyumlu ve bir yanıt zinciri varken üst notu tamamen yok etmez (yanıtlar
-- kalır, üst not "silindi" placeholder'ı olarak gösterilir — bkz. MobileEventNotes.jsx).
--
-- Yanıt tek seviye: parent_note_id kendi tablosuna referans verir. DB seviyesinde
-- derinlik kısıtlanmaz (bir yanıta yanıt insert edilebilir) — tek seviye kuralı
-- events.service.ts'de uygulanır (bir yanıtın kendi parent_note_id'si varsa yeni
-- yanıt reddedilir).
ALTER TABLE event_notes
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN parent_note_id bigint REFERENCES event_notes(id);

CREATE TRIGGER event_notes_touch_updated_at
  BEFORE UPDATE ON event_notes
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE INDEX event_notes_parent_note_id_idx ON event_notes(parent_note_id) WHERE parent_note_id IS NOT NULL;

-- "@" ile bahsedilen öğrenciler. Otomatik tamamlama istemci tarafında etkinlik
-- katılımcı listesinden beslenir (bkz. MobileEventNotes.jsx), ama saklanan
-- referans students(id)'edir — katılımcı kaydı etkinlikten kaldırılsa bile not
-- geçmişinde kim bahsedildiği kalır. author_name'de olduğu gibi görünen ad
-- (nickname/full_name) satıra kopyalanmaz, sorgu anında JOIN edilir.
CREATE TABLE event_note_mentions (
  note_id    bigint NOT NULL REFERENCES event_notes(id) ON DELETE CASCADE,
  student_id bigint NOT NULL REFERENCES students(id),
  PRIMARY KEY (note_id, student_id)
);

CREATE INDEX event_note_mentions_student_id_idx ON event_note_mentions(student_id);
