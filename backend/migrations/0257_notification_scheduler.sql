-- Ref: RBAC Faz 1 yol haritası, Etap 4 — bildirim zamanlayıcısı.
-- notification-scheduler.ts üç bağımsız tetikleyici için idempotent "gönderildi"
-- damgaları kullanır (UPDATE ... WHERE x IS NULL RETURNING id — atomik claim).
-- reminder_30_sent_at / reminder_10_sent_at: ders başlamadan 30/10 dk önce
-- hatırlatma; 10dk asla bastırılmaz, 30dk art arda ders varsa bastırılır (yine
-- de damgalanır). status_nudge_sent_at: 2+ saat geçmiş, hâlâ 'scheduled' ders
-- için tek seferlik durum dürtmesi.
ALTER TABLE lessons
  ADD COLUMN reminder_30_sent_at  timestamptz,
  ADD COLUMN reminder_10_sent_at  timestamptz,
  ADD COLUMN status_nudge_sent_at timestamptz;

-- Trendyol "yeni sipariş" bildirimi idempotensi defteri — sipariş bazında
-- (channel_order_lines satır bazında, bir sipariş N satır içerebilir).
CREATE TABLE notified_channel_orders (
  channel      text NOT NULL CHECK (channel IN ('trendyol', 'hepsiburada')),
  order_number text NOT NULL,
  notified_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, order_number)
);
