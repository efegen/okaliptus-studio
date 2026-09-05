-- Etkinlik detay ekranı (5a) "Notlar" kısayolu — Canvas-2 kapsamında değildi,
-- 0261'deki gibi "Yakında" pasif kart olarak bırakılmıştı (bkz.
-- MobileEventDetail.jsx üstteki not). Kullanıcı isteğiyle şimdi devreye alınıyor:
-- birden fazla kullanıcının paylaştığı, herkesin görebildiği serbest not akışı.
--
-- events.note (tek alan, Etkinlik ayarları'ndan düzenlenir) alanından bilinçli
-- olarak AYRI: bu tablo append-only bir günlük — kim ne zaman yazdıysa kalır,
-- düzenlenmez/silinmez (v1 kapsamı: ekle + listele).

CREATE TABLE event_notes (
  id             bigserial PRIMARY KEY,
  event_id       bigint NOT NULL REFERENCES events(id),
  author_user_id bigint NOT NULL REFERENCES users(id),
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_notes_event_id_idx ON event_notes(event_id, created_at DESC);
