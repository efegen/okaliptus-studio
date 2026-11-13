-- Web sitesi mağazası (okaliptusyoga.com/magaza) — ürün başına site ayarları.
--
-- Site, Trendyol ürünlerini panelin channel_products snapshot'ından okur
-- (bkz. 0243). Snapshot her senkronda yeniden yazıldığı için sitenin ayarları
-- ayrı tutulur: hangi ürün sitede gizli, hangi köşede durur, sitede hangi adla
-- görünür. Satır yoksa varsayılan: görünür, köşe başlıktan tahmin edilir,
-- ad Trendyol başlığıdır.
--
-- product_key = channel_products.product_main_id (varyantları gruplayan model
-- kodu); model kodu boşsa varyantın barkodu (external_id). Snapshot'a yabancı
-- anahtar yoktur: ürün Trendyol'dan kalkıp geri gelirse ayarı korunur.
--
-- ADDITIVE: yalnız ekleme.

BEGIN;

CREATE TABLE site_products (
  product_key   text PRIMARY KEY CHECK (char_length(product_key) BETWEEN 1 AND 200),
  hidden        boolean NOT NULL DEFAULT false,
  corner        text CHECK (corner IN ('arinma', 'meditasyon', 'taslar', 'pratik')),
  display_name  text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 120),
  updated_by    bigint REFERENCES users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMIT;
