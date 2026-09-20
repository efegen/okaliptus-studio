-- Kullanıcı aktivite özeti (yalnız owner görür): kullanıcı başına GÜNLÜK tek satır.
-- İstemci yalnız gerçek etkileşimde (dokunma/kaydırma/yazma, ekran görünürken)
-- en fazla dakikada bir ping atar; arka planda açık kalan uygulama sayılmaz.
-- session_count: önceki etkileşimden 15 dk'dan uzun ara sonrası gelen etkileşim
-- yeni "giriş" sayılır. IP/konum/cihaz bilgisi TUTULMAZ. Gün = Europe/Istanbul.
-- Saklama: 90 gün (ping akışında fırsatçı temizlik, bkz. user-activity.service.ts).

CREATE TABLE user_activity_days (
  user_id         bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day             date   NOT NULL,
  session_count   integer NOT NULL DEFAULT 1,
  last_active_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE INDEX user_activity_days_day_idx ON user_activity_days (day);
