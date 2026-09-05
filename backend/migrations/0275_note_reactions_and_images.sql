-- Ref: §11 — 0273 sonrası stüdyo geneli Notlar modülü.
--
-- Notlara ekip üyelerinin emoji tepkisi bırakabilmesi ve yeni nota tek bir
-- fotoğraf eklenebilmesi için iki ayrı yan tablo. Görsel bytes'ı notes satırına
-- konmaz: listNotes hot-path'i bytea taşımadan yalnız has_image/version döner,
-- içerik gerektiğinde GET /notes/:id/image ile alınır.
--
-- Tepkide (note, user, emoji) benzersizdir. Aynı kullanıcı aynı emojiyi tekrar
-- seçerse servis satırı silerek toggle eder; farklı emojiler bırakabilir.

BEGIN;

CREATE TABLE note_reactions (
  note_id     bigint NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       text NOT NULL CHECK (emoji IN ('👍', '❤️', '🙌', '😂', '😮', '😢')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id, emoji)
);

CREATE INDEX note_reactions_note_id_idx ON note_reactions(note_id);

CREATE TABLE note_images (
  note_id     bigint PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  mime        text NOT NULL CHECK (mime IN ('image/webp', 'image/jpeg', 'image/png')),
  bytes       bytea NOT NULL CHECK (octet_length(bytes) > 0 AND octet_length(bytes) <= 5242880),
  byte_size   integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;
