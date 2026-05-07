-- v1.6 — product_sales sepet kalemleri.
-- product_sales.total_amount tek satır toplam; bu tablo onun açılımını verir.
-- Servis tarafında yeni satışlarda zorunlu (createProductSale.items[]).
-- Geriye dönük uyum: mevcut product_sales satırlarında item yok — okuyucular
-- items boş döndüğünde "legacy line" olarak fallback yapar.
--
-- Snapshot kuralı (lessons.price_snapshot ile aynı felsefe):
--   product katalog sonradan güncellense bile satış kaydındaki name_snapshot
--   ve unit_price_snapshot değişmez. Rapor immutable kalır.
--
-- product_id nullable: katalog dışı serbest kalemler ("ad + fiyat manuel girildi")
-- ve gelecekte arşivlenip silinen ürünler için. RESTRICT koruması var ama
-- archive yerine soft-retire pattern'i kullanıldığı için pratikte tetiklenmez.

CREATE TABLE product_sale_items (
  id                   bigserial PRIMARY KEY,
  sale_id              bigint NOT NULL REFERENCES product_sales(id) ON DELETE CASCADE,
  product_id           bigint REFERENCES products(id) ON DELETE RESTRICT,
  name_snapshot        text NOT NULL,
  unit_price_snapshot  numeric(10,2) NOT NULL CHECK (unit_price_snapshot > 0),
  quantity             integer NOT NULL CHECK (quantity > 0),
  line_total           numeric(10,2) NOT NULL CHECK (line_total > 0),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_sale_items_sale ON product_sale_items (sale_id);
CREATE INDEX idx_product_sale_items_product ON product_sale_items (product_id) WHERE product_id IS NOT NULL;
