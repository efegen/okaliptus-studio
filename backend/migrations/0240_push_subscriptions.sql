-- Ref: yeni özellik — Web Push (PWA bildirimleri) altyapısı (spec dışı, v1 sonrası).
-- Amaç: tek bir test kullanıcısına izole bildirim göndermek. Her satır bir
-- tarayıcı/cihaz push aboneliğini bir kullanıcıya bağlar. Bildirim YALNIZ ilgili
-- user_id'nin endpoint'lerine gönderilir; kullanıcı izolasyonu buradan gelir.
--
-- endpoint UNIQUE: aynı cihaz tekrar subscribe olunca yeni satır yaratmaz, upsert
-- edilir (push.service.ts ON CONFLICT). ON DELETE CASCADE: kullanıcı silinince
-- abonelikleri otomatik temizlenir.

CREATE TABLE push_subscriptions (
  id           bigserial   PRIMARY KEY,
  user_id      bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     text        NOT NULL UNIQUE,
  p256dh       text        NOT NULL,
  auth         text        NOT NULL,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_idx ON push_subscriptions(user_id);
