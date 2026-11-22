-- Ref: web sitesi formları (okaliptusyoga.com) → panel "Talepler".
--
-- Sitenin üç formu tek uca (POST /public/inquiries) gönderir; her gönderim bu
-- tabloda bir satırdır:
--   'contact' → ana sayfadaki "Bize ulaşın" formu (konu + mesaj)
--   'lesson'  → /dersler sayfasındaki birebir ders talebi (stüdyo/online + şehir)
--   'camp'    → etkinlik sayfasındaki ön kayıt (giriş, kişi sayısı, oda tercihi)
-- Forma özel alanlar details jsonb'de, ETİKETLERİYLE birlikte durur (ör.
-- eventTitle, roomLabel, price): panel sitenin verisini bilmeden gösterebilir ve
-- ziyaretçinin o an gördüğü fiyat kaydedilir.
--
-- Kayıp yok ilkesi: hiçbir gönderim üzerine yazılmaz ya da silinmez.
--   - client_id: sitenin her gönderime verdiği kimlik. Ağ hatasında aynı istek
--     tekrar gelirse yeni satır açılmaz (ON CONFLICT).
--   - duplicate_of: aynı telefondan aynı türde 24 saat içinde gelen ikinci
--     gönderim ayrı satırdır ama ilkine bağlanır; ikinci bildirim gitmez.
--   - suspect_reason: otomatik şüphe (tuzak alan dolu, çok hızlı gönderim, Origin
--     yok, aynı kaynaktan çok sık, doğrulama başarısız). Şüpheli satır SİLİNMEZ ve
--     bildirim göndermez; panelde ayrı görünür, insan karar verir.
--
-- notified_at: bildirim işi bitti (gönderildi ya da bilerek atlandı: şüpheli /
-- tekrar). Zamanlayıcı yalnız notified_at IS NULL satırları claim eder.

CREATE TABLE site_inquiries (
  id                bigserial PRIMARY KEY,
  client_id         uuid        NOT NULL UNIQUE,
  kind              text        NOT NULL CHECK (kind IN ('contact', 'lesson', 'camp')),
  status            text        NOT NULL DEFAULT 'new'
                                CHECK (status IN ('new', 'contacted', 'converted', 'closed', 'spam')),
  suspect_reason    text        CHECK (suspect_reason IN ('trap', 'too_fast', 'no_origin', 'burst', 'captcha')),
  full_name         text        NOT NULL,
  phone             text        NOT NULL,
  -- Yalnız rakamlar, son 10 hane: tekrar tespiti ve öğrenci eşleştirmesi için.
  phone_key         text        NOT NULL,
  email             text,
  message           text,
  details           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  page              text,
  duplicate_of      bigint      REFERENCES site_inquiries(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  notified_at       timestamptz,
  handled_by        bigint      REFERENCES users(id),
  handled_at        timestamptz,
  note              text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX site_inquiries_created_idx ON site_inquiries (created_at DESC);
CREATE INDEX site_inquiries_status_idx ON site_inquiries (status, created_at DESC);
CREATE INDEX site_inquiries_phone_idx ON site_inquiries (phone_key, kind, created_at DESC);
CREATE INDEX site_inquiries_pending_notify_idx ON site_inquiries (created_at) WHERE notified_at IS NULL;

-- Bildirim türü: yeni site talebi. Alıcılar yeni sipariş bildirimindeki gibi
-- owner + admin + instructor (panelden kişi bazında değiştirilir).
-- {title}: türe göre "Yeni ön kayıt" / "Yeni ders talebi" / "Yeni mesaj".
INSERT INTO notification_settings (key, enabled, recipient_user_ids, config) VALUES (
  'site_inquiry',
  true,
  COALESCE((SELECT array_agg(id ORDER BY id) FROM users WHERE role IN ('owner', 'admin', 'instructor') AND is_active), '{}'::bigint[]),
  '{
    "titleTemplate": "{title}",
    "bodyTemplate": "{name}: {summary}"
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;
