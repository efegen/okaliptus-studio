-- Ref: Etap 4 devamı — panelden ayarlanabilir bildirim modülü.
-- notification-scheduler.ts artık sabit kod yerine bu tablodan okur: her bildirim
-- türü için aç/kapa, KİŞİ-bazlı alıcı listesi (recipient_user_ids) ve tür-özel
-- config (zamanlama + metin şablonu). Ek olarak tek bir '_global' satırı sessiz
-- saatleri tutar.
--
-- key değerleri: 'lesson_reminder' (ders başlıyor — erken/geç yuva), 'stale_lesson'
-- (bayat ders durumu), 'new_order' (yeni Trendyol siparişi), '_global' (sessiz
-- saatler; enabled = sessiz saatler açık mı).
--
-- reminder yuvaları: lessons.reminder_30_sent_at "erken", reminder_10_sent_at
-- "geç" yuvası olarak yeniden kullanılır (dakikalar config'ten gelir; kolon adı
-- sabit kalır). status_nudge_sent_at bayat ders için (0257).

CREATE TABLE notification_settings (
  key                text PRIMARY KEY,
  enabled            boolean  NOT NULL DEFAULT true,
  recipient_user_ids bigint[] NOT NULL DEFAULT '{}',
  config             jsonb    NOT NULL DEFAULT '{}'::jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Seed: mevcut sabit-kod davranışını KORU. Alıcılar migration anındaki aktif
-- kullanıcılardan türetilir (kişi-bazlı modele geçiş); ders bildirimleri
-- 'instructor' rolündekilere, yeni sipariş owner+admin+instructor'a gider.
INSERT INTO notification_settings (key, enabled, recipient_user_ids, config) VALUES
(
  'lesson_reminder',
  true,
  COALESCE((SELECT array_agg(id ORDER BY id) FROM users WHERE role = 'instructor' AND is_active), '{}'::bigint[]),
  '{
    "early": { "enabled": true, "minutes": 30, "suppressIfBusy": true },
    "late":  { "enabled": true, "minutes": 10, "suppressIfBusy": false },
    "titleTemplate": "Ders başlıyor",
    "bodyTemplate": "{student} ile dersiniz {minutes} dakika sonra başlıyor."
  }'::jsonb
),
(
  'stale_lesson',
  true,
  COALESCE((SELECT array_agg(id ORDER BY id) FROM users WHERE role = 'instructor' AND is_active), '{}'::bigint[]),
  '{
    "thresholdMinutes": 120,
    "titleTemplate": "Ders durumu bekliyor",
    "bodyTemplate": "{student} ile {time} dersi hâlâ ''planlandı'' — gerçekleşti mi? Durumu işaretle."
  }'::jsonb
),
(
  'new_order',
  true,
  COALESCE((SELECT array_agg(id ORDER BY id) FROM users WHERE role IN ('owner', 'admin', 'instructor') AND is_active), '{}'::bigint[]),
  '{
    "titleTemplate": "Yeni sipariş",
    "bodyTemplate": "Trendyol''dan yeni sipariş: {customer} — #{order}"
  }'::jsonb
),
(
  '_global',
  false,
  '{}'::bigint[],
  '{ "quietHoursStart": "22:00", "quietHoursEnd": "08:00" }'::jsonb
);
