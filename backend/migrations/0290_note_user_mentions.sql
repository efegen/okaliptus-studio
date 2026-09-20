-- Notlarda kullanıcı etiketi ("@Efe"). Öğrenci etiketinden (note_mentions) farkı:
-- gövde metnine AD değil `@{u:<user_id>}` belirteci yazılır ve görünen ad okuma
-- anında users.display_name'den çözülür — kullanıcının adı sonradan değişirse
-- eski notlarda da güncel görünür. Bu tablo etiketlenenleri (bildirim ve okuma
-- tarafı için) tutar; eski notlar etiket içermez, backfill gerekmez.
--
-- notification_settings'e iki tür eklenir (alıcı = ilgili kişi, global alıcı yok):
--   'note_reply'   → notun yazarına yanıt gelince ("size yanıt verdi")
--   'note_mention' → bir notta/yanıtta etiketlenince

CREATE TABLE note_user_mentions (
  note_id  bigint NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id  bigint NOT NULL REFERENCES users(id),
  PRIMARY KEY (note_id, user_id)
);

CREATE INDEX note_user_mentions_user_id_idx ON note_user_mentions(user_id);

INSERT INTO notification_settings (key, enabled, recipient_user_ids, config) VALUES
(
  'note_reply',
  true,
  '{}'::bigint[],
  '{
    "titleTemplate": "{author} size yanıt verdi",
    "bodyTemplate": "{note}"
  }'::jsonb
),
(
  'note_mention',
  true,
  '{}'::bigint[],
  '{
    "titleTemplate": "{author} sizi bir notta etiketledi",
    "bodyTemplate": "{note}"
  }'::jsonb
);
