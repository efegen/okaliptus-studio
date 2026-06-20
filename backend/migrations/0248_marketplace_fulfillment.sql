-- 0248 — Pazaryeri sipariş işleme (fulfillment) flag'i.
-- Spec: [[project_marketplace_mapping]] Faz 2 — kargo etiketi yazdırma.
--
-- Kargo etiketi yazdırmak Trendyol'a YAZMA gerektirir (Ortak Etiket / common-label
-- oluşturma; gerekirse paket "İşleme Al"/Picking). Bu flag o yazma yolunu açar.
-- DEFAULT false → deploy edilse bile kullanıcı AÇANA KADAR hiçbir yazma yapılmaz.
--
-- STOK flag'lerinden (marketplace_orders_enabled / marketplace_stock_push_enabled) ve
-- sipariş GÖRÜNÜMÜ flag'inden (marketplace_sync_enabled, salt-okunur) BAĞIMSIZDIR:
-- kullanıcı "stok kapalı + siparişleri gör + etiket yazdır" senaryosunu kurabilsin diye.
--
-- ADDITIVE: yalnız kolon ekler.

BEGIN;

ALTER TABLE studio_settings
  ADD COLUMN IF NOT EXISTS marketplace_fulfillment_enabled boolean NOT NULL DEFAULT false;

COMMIT;
