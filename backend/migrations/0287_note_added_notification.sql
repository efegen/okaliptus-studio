-- Bildirim modülüne 'note_added' türü: Notlar akışına yeni (genel) not veya yanıt
-- eklendiğinde push. Düzenleme/silme ve etkinlik notları (event_notes) tetiklemez.
-- Alıcılar varsayılan olarak TÜM aktif kullanıcılardır (config.allUsers = true;
-- sonradan eklenen kullanıcılar dahil), notu yazan hariç. Owner Ayarlar →
-- Bildirimler'den kapatabilir veya alıcıları kişi bazlı seçebilir.

INSERT INTO notification_settings (key, enabled, recipient_user_ids, config) VALUES
(
  'note_added',
  true,
  '{}'::bigint[],
  '{
    "allUsers": true,
    "titleTemplate": "{author} yeni not ekledi",
    "bodyTemplate": "{note}"
  }'::jsonb
);
