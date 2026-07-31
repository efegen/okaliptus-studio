-- v1.7 — POS satış silmede stok iadesi (sale_cancel telafi hareketi).
--
-- Bağlam: ürün satışı soft-delete edilince (product-sales.service.ts
-- softDeleteProductSale) düşülen stok GERİ VERİLMELİ. Tasarım: satış anındaki
-- gerçek bileşen deltaları zaten stock_movements'te related_sale_id ile duruyor;
-- ters-kayıt bu satırları GERİ OKUYUP negatifleyerek 'sale_cancel' telafi satırı
-- yazar (channel_sale ↔ channel_cancel ikizi). Yeniden patlatma YAPILMAZ — bundle
-- bileşimi satıştan sonra değişmişse sapma yaratırdı.
--
-- Üç ADDITIVE değişiklik:
--   1) stock_movements_type_check'e 'sale_cancel' eklenir (0244 kalıbı; tam liste
--      yeniden yazılır — eksik liste mevcut insert'leri kırar).
--   2) related_sale_id FK'si ON DELETE SET NULL yapılır. Bugüne dek NO ACTION idi
--      → hardDeleteStudent (DELETE FROM product_sales) stok hareketi olan öğrencide
--      FK ihlaliyle patlıyordu. SET NULL doğru semantik: mal fiziksel çıktı, hareket
--      defterde kalır, on_hand DEĞİŞMEZ; yalnız satışa işaret eden bağ kopar.
--      (CASCADE yanlış olurdu — düşüm satırını silip on_hand'i sessizce şişirirdi.)
--   3) related_sale_id üzerine kısmi index — ters-kayıt her silmede bu sütunla
--      sorgular; 0241 yalnız product_id index'i tanımlamıştı.
--
-- audit_logs CHECK'ine DOKUNULMAZ: 'product_sale_deleted' zaten listede ve servis
-- zaten yazıyor; stok iadesi ayrı audit yazmaz (recordSaleStockMovements ile simetrik).

BEGIN;

-- ── 1) sale_cancel tipi ─────────────────────────────────────────────────────
-- 0244'teki 6 değer + 'sale_cancel'. Liste tam kopyalanır.
--   sale_cancel → POS satış silmede geri ekleme (+); related_sale_id dolu kalır.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN (
    'sale',
    'restock',
    'manual_adjustment',
    'return',
    'channel_sale',
    'channel_cancel',
    'sale_cancel'
  ));

-- ── 2) related_sale_id FK → ON DELETE SET NULL ──────────────────────────────
-- 0241 inline tanımladığı için otomatik ad (stock_movements_related_sale_id_fkey).
-- İsim kaymasına bağışık olmak için katalogdan dinamik bulup düşürürüz: bu tabloda
-- product_sales'e referans veren FK ne adla olursa olsun kaldırılır, sonra açık
-- adla SET NULL olarak yeniden eklenir.
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT con.conname INTO fk_name
  FROM pg_constraint con
  JOIN pg_class rel   ON rel.oid = con.conrelid
  JOIN pg_class fref  ON fref.oid = con.confrelid
  WHERE con.contype = 'f'
    AND rel.relname  = 'stock_movements'
    AND fref.relname = 'product_sales';

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE stock_movements DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_related_sale_id_fkey
  FOREIGN KEY (related_sale_id) REFERENCES product_sales(id) ON DELETE SET NULL;

-- ── 3) related_sale_id kısmi index ──────────────────────────────────────────
-- Ters-kayıt: SELECT ... WHERE related_sale_id = $1 AND type = 'sale'.
CREATE INDEX IF NOT EXISTS idx_stock_movements_related_sale
  ON stock_movements (related_sale_id) WHERE related_sale_id IS NOT NULL;

COMMIT;
