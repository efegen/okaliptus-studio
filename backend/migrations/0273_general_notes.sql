-- "Notlar" (0268_event_notes.sql + 0270_event_note_updates.sql) kullanıcı
-- isteğiyle etkinlikten koparılıyor: artık TEK bir GENEL not alanı var. Mobil
-- ana sayfadaki "Notlar" butonu ve etkinlik detayındaki "Notlar" kısayolu aynı
-- listeyi açar; etkinlik başına ayrı not akışı yok.
--
-- event_id nullable bırakılmak yerine tamamen düşürülür — "genel not" /
-- "etkinlik notu" ikiliği kalmasın diye. Şimdiye kadar yazılmış notlar silinmez,
-- genel akışa taşınır. events.note (Etkinlik ayarları'ndaki tekil, düzenlenebilir
-- alan) bundan etkilenmez; o hâlâ etkinliğe özeldir.
--
-- Tablo artık etkinliğe ait olmadığı için adlar da genelleşiyor: event_notes →
-- notes, event_note_mentions → note_mentions. İndeks/trigger/sequence/constraint
-- adları tabloyu takip etsin diye elle yeniden adlandırılır (PostgreSQL tablo
-- adı değişince bunları kendiliğinden güncellemez).

BEGIN;

ALTER TABLE event_notes RENAME TO notes;
ALTER TABLE event_note_mentions RENAME TO note_mentions;

-- FK ve event_notes_event_id_idx bu sütunla birlikte düşer.
ALTER TABLE notes DROP COLUMN event_id;

-- Liste sorgusu (bkz. notes.service.ts listNotes) artık yalnız created_at DESC
-- ile sıralanır; düşen event_id indeksinin yerini bu alır.
CREATE INDEX notes_created_at_idx ON notes(created_at DESC);

ALTER INDEX event_notes_parent_note_id_idx RENAME TO notes_parent_note_id_idx;
ALTER INDEX event_note_mentions_student_id_idx RENAME TO note_mentions_student_id_idx;

ALTER SEQUENCE event_notes_id_seq RENAME TO notes_id_seq;

ALTER TRIGGER event_notes_touch_updated_at ON notes RENAME TO notes_touch_updated_at;

ALTER TABLE notes RENAME CONSTRAINT event_notes_pkey TO notes_pkey;
ALTER TABLE notes RENAME CONSTRAINT event_notes_author_user_id_fkey TO notes_author_user_id_fkey;
ALTER TABLE notes RENAME CONSTRAINT event_notes_parent_note_id_fkey TO notes_parent_note_id_fkey;

ALTER TABLE note_mentions RENAME CONSTRAINT event_note_mentions_pkey TO note_mentions_pkey;
ALTER TABLE note_mentions RENAME CONSTRAINT event_note_mentions_note_id_fkey TO note_mentions_note_id_fkey;
ALTER TABLE note_mentions RENAME CONSTRAINT event_note_mentions_student_id_fkey TO note_mentions_student_id_fkey;

COMMIT;
