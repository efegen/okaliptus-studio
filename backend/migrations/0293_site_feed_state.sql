-- Web sitesi mağazası — otomatik yenileme durumu (bkz. site-refresh.service.ts).
--
-- Panel saatte bir bakar: Trendyol ürün listesi (channel_products) 24 saatten
-- eskiyse yeniler, sonra sitenin göreceği listenin parmak izini (fingerprint)
-- çıkarır. Parmak izi değiştiyse ve siteyi yeniden build ettiren adres
-- (SITE_DEPLOY_HOOK_URL) tanımlıysa ona haber verir. Bu tablo son parmak izini
-- ve son haberi tutar; tek satırdır (id = 1).
--
-- ADDITIVE: yalnız ekleme.

BEGIN;

CREATE TABLE site_feed_state (
  id               smallint PRIMARY KEY CHECK (id = 1),
  fingerprint      text,
  product_count    integer,
  changed_at       timestamptz,
  hook_called_at   timestamptz,
  last_sync_at     timestamptz,
  last_sync_error  text
);

INSERT INTO site_feed_state (id) VALUES (1);

COMMIT;
