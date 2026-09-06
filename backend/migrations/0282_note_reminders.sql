-- Ref: yoga-studio-dashboard-v1-spec.md "Notlar akışı genişletmesi (2026-09-05)" —
-- o bölüm hatırlatıcı UI'sinin bilinçli olarak yalnız bir prototip olduğunu,
-- kalıcılık/zamanlayıcı/alıcı API'sinin BİLEREK eklenmediğini belirtiyordu. Bu
-- migration o eksiği kapatır: hatırlatıcı artık kalıcıdır ve gerçekten
-- bildirim gönderir (bkz. notification-scheduler.ts checkNoteReminders).
--
-- Tek satır = bir not için tek seferlik hatırlatma (birden çok alıcıya aynı
-- anda gider — bkz. recipient_user_ids). Ders hatırlatmalarının aksine (sabit
-- dakika penceresi, lessons üzerinde kolon) burada zaman kullanıcı tarafından
-- serbestçe seçilir; bu yüzden lessons deseni yerine kendi tablosu var.
-- Gönderim durumu tek `sent_at` damgasıyla izlenir (tüm alıcılara tek seferde
-- gönderilir, alıcı bazlı ayrı durum gerekmez).
--
-- notification_settings'e 'note_reminder' anahtarı eklenir: yalnız metin
-- şablonu ayarlanabilir (bkz. notification-settings.service.ts) — alıcılar bu
-- türde GLOBAL değildir, her hatırlatmayla birlikte notu oluşturan kullanıcı
-- tarafından seçilir (recipient_user_ids kolonu).

CREATE TABLE note_reminders (
  id                  bigserial PRIMARY KEY,
  note_id             bigint NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_by_user_id  bigint NOT NULL REFERENCES users(id),
  remind_at           timestamptz NOT NULL,
  recipient_user_ids  bigint[] NOT NULL,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT note_reminders_recipients_not_empty CHECK (cardinality(recipient_user_ids) > 0)
);

-- Zamanlayıcının her tick'te taradığı "gönderilmeyi bekleyen" satırlar için.
CREATE INDEX note_reminders_due_idx ON note_reminders (remind_at) WHERE sent_at IS NULL;
CREATE INDEX note_reminders_note_id_idx ON note_reminders (note_id);

INSERT INTO notification_settings (key, enabled, recipient_user_ids, config) VALUES
(
  'note_reminder',
  true,
  '{}'::bigint[],
  '{
    "titleTemplate": "Not hatırlatması",
    "bodyTemplate": "{author}: {note}"
  }'::jsonb
);
