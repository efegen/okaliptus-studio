-- v1.6 — Ürün varyantları + kategori desteği.
--
-- Trendyol satıcı paneli "Model Kodu" (örn. OKY-BUH) ile aynı ürünün renk/beden
-- varyantlarını gruplar. Excel'de aynı Model Kodu'nu paylaşan satırlar (8 farklı
-- renkte buhurdanlık gibi) tek mantıksal ürünün varyantlarıdır. Bu migration
-- product satırlarına bu grup ilişkisini ve kategori meta'sını ekler.
--
-- Tasarım: ayrı bir "parent product" satırı tutmuyoruz. Her varyant kendi
-- ürün satırı; aynı parent_product_code'u paylaşanlar UI tarafından gruplanır.
-- Avantaj: cart akışı değişmez (her varyant zaten ayrı satışılabilir kalem),
-- snapshot/rapor mantığı bozulmaz, "boş parent" rowları olmaz.
--
-- Alanlar:
--   parent_product_code  Trendyol Model Kodu — varyant grup anahtarı, opsiyonel
--                        (elden eklenen tek ürünlerde NULL kalabilir)
--   variant_label        Renk + Beden + Boyut + Cinsiyet birleşimi, UI display
--                        (örn. "Mavi", "80x28", "Mor · L")
--   category             Trendyol "Kategori İsmi" — free text, kategori
--                        FK tablosu yok (v1 sadelik, kategori sayısı düşük)

ALTER TABLE products
  ADD COLUMN parent_product_code text,
  ADD COLUMN variant_label       text,
  ADD COLUMN category             text;

CREATE INDEX idx_products_parent_code
  ON products (parent_product_code)
  WHERE parent_product_code IS NOT NULL AND archived_at IS NULL;

CREATE INDEX idx_products_category
  ON products (category)
  WHERE category IS NOT NULL AND archived_at IS NULL;
