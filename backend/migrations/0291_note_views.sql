-- Not / yanıt görüntülenme takibi: kim, hangi notu ilk ne zaman GÖRDÜ.
-- İstemci bir notu ekranda gerçekten görünür bulduğunda (yarıdan fazlası, ~1 sn,
-- uygulama ön plandayken) toplu olarak bildirir. Aynı kişi tekrar görse de tek
-- satır kalır (ilk görülme saklanır). Notun yazarı kendi notunu "görmüş"
-- sayılmaz — satır yazılmaz. Eski notlar için geçmiş doldurma (backfill) YOK:
-- gerçekte kimin gördüğü bilinemez, sayaç kişiler açtıkça dolar.

CREATE TABLE note_views (
  note_id        bigint NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id        bigint NOT NULL REFERENCES users(id),
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id)
);

CREATE INDEX note_views_user_id_idx ON note_views(user_id);
