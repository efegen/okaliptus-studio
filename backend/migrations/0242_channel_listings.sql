-- v1.6 — Kanal eşleştirme (channel_listings): pazaryeri temeli.
--
-- Kapsam DAR: yalnız İÇ veri modeli — hangi iç ürün = hangi Trendyol/Hepsiburada
-- listing'i, kanal başına fiyat ve "listeli mi" bilgisi. Hiçbir dış API çağrısı,
-- poller, sipariş çekme, stok push, webhook YOK. Sadece tablo + CRUD + UI.
--
-- external_id: gelen siparişi iç ürüne bağlayan anahtar (TY: barkod, HB:
-- merchantSku). UNIQUE (channel, external_id) → bir kanalda bir external_id tek
-- ürüne işaret etmeli; sipariş eşleştirmesi (ileride) bunun üzerine kurulacak.
--
-- marketplace_sync_enabled: stok takibi flag'inden (0241) AYRI bir flag. Tüm
-- pazaryeri işleri (bu PR'da sadece bu kanal eşleştirme UI'ı) bununla gated;
-- DEFAULT false olduğundan flag açılana kadar hiçbir davranış değişmez.
--
-- ADDITIVE: yalnız ekleme. Mevcut tablo/kolon drop/alter YOK.

BEGIN;

-- ── channel_listings: iç ürün ↔ kanal listing eşlemesi ──────────────────────
CREATE TABLE channel_listings (
  id             bigserial PRIMARY KEY,
  product_id     bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel        text NOT NULL CHECK (channel IN ('trendyol', 'hepsiburada')),
  external_id    text NOT NULL,
  channel_price  numeric(10,2),
  is_listed      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);

-- "Bu ürünün kanalları" sorgusu için.
CREATE INDEX idx_channel_listings_product ON channel_listings (product_id);

-- updated_at otomatik dokunma (mevcut trigger fonksiyonu — 0050/0229'da products
-- için de kullanıldı).
CREATE TRIGGER channel_listings_touch_updated_at
  BEFORE UPDATE ON channel_listings
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- ── studio_settings: pazaryeri senkron flag'i (stok flag'inden ayrı) ────────
ALTER TABLE studio_settings
  ADD COLUMN IF NOT EXISTS marketplace_sync_enabled boolean NOT NULL DEFAULT false;

-- ── audit_logs: 'channel_listing_changed' action'ı ──────────────────────────
-- 0241'deki tam action listesi korunur; yalnız 'channel_listing_changed' eklenir.
-- entity_type listesi değişmez: kanal değişimi entity_type='product' kullanır
-- (entity_id = product_id). Constraint adı (audit_logs_action_check) korunur.
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_action_check
  CHECK (action IN (
    'lesson_created',
    'lesson_status_change',
    'lesson_uncompleted',
    'lesson_updated',
    'lesson_deleted',
    'lesson_discount_updated',
    'bulk_price_update',
    'payment_created',
    'payment_updated',
    'payment_deleted',
    'product_sale_created',
    'product_sale_updated',
    'product_sale_deleted',
    'prepaid_package_created',
    'prepaid_package_deleted',
    'student_created',
    'student_updated',
    'student_deleted',
    'lesson_type_created',
    'lesson_type_updated',
    'lesson_type_student_price_set',
    'lesson_type_student_price_removed',
    'instructor_created',
    'instructor_updated',
    'instructor_deleted',
    'product_created',
    'product_updated',
    'product_archived',
    'product_unarchived',
    'product_deleted',
    'settings_updated',
    'user_login',
    'user_logout',
    'stock_adjusted',
    'channel_listing_changed'
  ));

COMMIT;
