-- Spec §11 "Katılımcı profili not akışı" (2026-09-06): etkinlik katılımcı
-- profilindeki tekil, üzerine-yazılan not alanı (event_participants.note)
-- birden fazla notun eklenebildiği, her notta yazarı görünen bir günlüğe
-- dönüşüyor. Genel "Notlar" (bkz. notes.service.ts / 0273_general_notes.sql)
-- ile KARIŞTIRILMAZ: bu notlar yalnız bu katılımcının bu etkinlikteki
-- profilinde görünür, stüdyo geneline sızmaz.
--
-- Kapsam bilinçli olarak dar: yanıt/bahis/tepki/fotoğraf/kategori YOK (genel
-- Notlar'ın aksine) — yalnız "ekle, yazarı görünsün, yalnız kendi yazdığını
-- düzenle/sil". Soft-delete de yok: korunması gereken bir yanıt zinciri
-- olmadığından silme kalıcıdır (audit_logs zaten before/after'ı saklar).

BEGIN;

CREATE TABLE event_participant_notes (
  id             bigserial PRIMARY KEY,
  participant_id bigint NOT NULL REFERENCES event_participants(id) ON DELETE CASCADE,
  author_user_id bigint NOT NULL REFERENCES users(id),
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_participant_notes_participant_idx
  ON event_participant_notes(participant_id, created_at DESC, id DESC);

CREATE TRIGGER event_participant_notes_touch_updated_at
  BEFORE UPDATE ON event_participant_notes
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- Eski tekil alan bu tabloyla değiştirildi; frontend artık hiç yazmıyor.
ALTER TABLE event_participants DROP COLUMN note;

INSERT INTO audit_log_actions (action) VALUES
  ('event_participant_note_created'),
  ('event_participant_note_updated'),
  ('event_participant_note_deleted');

INSERT INTO audit_log_entity_types (entity_type) VALUES
  ('event_participant_note');

COMMIT;
