-- v1.6 — Ürün katalogu.
-- Önceki sürümlerde product_sales serbest tutar + serbest not aldı; ürün
-- bilgisi DB'de tutulmuyordu. Bu migration, ürünleri kalıcı kayıt haline
-- getirir: barkod, ad, fiyat ve resim URL'i.
--
-- Kapsam:
-- - Stok kolonu YOK (kullanıcı kararı). Trendyol/Hepsiburada stoklarını
--   ilgili panellerde yönetmeye devam eder.
-- - Tek fiyat (elden satış). Marketplace fiyatları DB'de saklanmaz.
-- - image_url public bir URL'dir; backend dosya hosting yapmaz. Trendyol
--   CDN URL'leri (cdn.dsmcdn.com/...) doğrudan saklanır.
-- - barcode UNIQUE ama nullable: aynı ürünün TY/HB/elden hâlleri tek
--   satırda; barkodu olmayan elden ürünler için NULL geçerli.
-- - archived_at: ürün silinmez; arşivlenir. Geçmiş satışlar
--   product_sale_items.name_snapshot ile bağımsız okunabilir kalır.

CREATE TABLE products (
  id              bigserial PRIMARY KEY,
  barcode         text UNIQUE,
  name            text NOT NULL,
  price           numeric(10,2) NOT NULL CHECK (price > 0),
  image_url       text,
  ty_listing_url  text,
  hb_listing_url  text,
  notes           text,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_active_name ON products (name) WHERE archived_at IS NULL;

CREATE TRIGGER products_touch_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
