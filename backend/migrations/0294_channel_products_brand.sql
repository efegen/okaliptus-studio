-- Trendyol ürün snapshot'ına marka (channel_products.brand).
--
-- Web sitesi mağazası ürün kartında markayı Trendyol'daki gibi gösterir
-- (bkz. site-catalog.service.ts). Marka ürün düzeyindedir; senkron her
-- varyanta aynı değeri yazar. Mevcut satırlarda boştur ve bir sonraki
-- senkronda dolar: o senkron beklemesin diye snapshot'ın yenilenme zamanı
-- 25 saat geri alınır, böylece otomatik yenileme (site-refresh, 24 saat)
-- deploy'dan hemen sonra çalışır. synced_at yalnız tazelik için kullanılır.
--
-- ADDITIVE: yalnız ekleme.

BEGIN;

ALTER TABLE channel_products ADD COLUMN brand text;

UPDATE channel_products
   SET synced_at = LEAST(synced_at, now() - interval '25 hours')
 WHERE channel = 'trendyol';

COMMIT;
