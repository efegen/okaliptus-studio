-- v1.6 — Kanal ürün snapshot'ı (channel_products).
--
-- Amaç: pazaryeri kanalının (şimdilik Trendyol) TÜM ürün/varyant listesinin yerel
-- bir kopyası. "Ürün eşleştirme" ekranı bu snapshot'tan hızlı açılır; iç katalog
-- (products) ile channel_listings üzerinden eşleştirilir.
--
-- Granülerlik = VARYANT. Trendyol approved-products yanıtında barkod/stok/fiyat
-- ürün üstünde değil variants[] içindedir; external_id = variants[].barcode
-- (sipariş satırındaki barcode ve channel_listings.external_id ile aynı anahtar).
--
-- Bu bir CACHE'tir: "Senkronize et" butonu doldurur/günceller (manuel, poller yok).
-- Audit gerekmez. channel_listings (eşleme/mapping) ayrı tablodur ve buradan
-- bağımsızdır; snapshot silinse bile eşlemeler durur.
--
-- HB: API yok → HB satırı buraya OTOMATİK gelmez (HB eşlemesi elle channel_listings'e
-- girilir). channel kolonu yine de iki değeri kabul eder (ileri uyum).
--
-- ADDITIVE: yalnız ekleme.

BEGIN;

CREATE TABLE channel_products (
  id               bigserial PRIMARY KEY,
  channel          text NOT NULL CHECK (channel IN ('trendyol', 'hepsiburada')),
  external_id      text NOT NULL,            -- variants[].barcode (eşleme anahtarı)
  product_main_id  text,                     -- model kodu (varyantları gruplar)
  title            text,
  quantity         integer,
  list_price       numeric(10,2),
  sale_price       numeric(10,2),
  on_sale          boolean,
  archived         boolean,
  product_url      text,
  image_url        text,
  raw              jsonb,                     -- ileride alan eklemek için ham varyant
  synced_at        timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);

-- Eşleme join'i (channel_listings.external_id ile) ve iç ürün barkod eşleşmesi için.
CREATE INDEX idx_channel_products_external ON channel_products (channel, external_id);

COMMIT;
