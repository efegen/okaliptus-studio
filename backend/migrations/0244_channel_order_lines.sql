-- v1.6 — Model C / Faz 1: Pazaryeri sipariş→stok bağı (yalnız Trendyol, PULL).
--
-- Amaç: Trendyol siparişleri periyodik çekilince iç stok OTOMATİK düşsün/geri
-- gelsin; "TY satışı içeri düşmüyor" tutarsızlığı bitsin. PUSH YOK (Faz 2). Bu
-- migration yalnız İÇ veri modelini kurar; dış API'ye hiçbir yazma yapmaz.
--
-- channel_order_lines = idempotensi defteri. Poller her turda aynı siparişi
-- tekrar görür; bu tablo "bu satırı saydım mı, ne kadar düştüm" bilgisini SATIR
-- (orderLineId) granülerliğinde tutar. Yeniden işleme no-op'tur. Net stok etkisi
-- applied_delta'da; gerçek hareketler her zaman stock_movements'a (append-only
-- delta-ledger, 0241) yazılır — bu tablo onların ÖZETİ/idempotensi anahtarıdır.
--
-- state (BİZİM uyguladığımız durum, TY ham status'undan türetilir):
--   counted        → sipariş canlı/satıldı; -qty düşüldü (applied_delta<0)
--   reversed       → iptal edildi; düşülen miktar geri eklendi (applied_delta=0)
--   return_pending → satılıp sonra İADE edildi; OTOMATİK geri eklenMEZ, operatör
--                    malı sağlamsa elle setStock'la ekler → inceleme kuyruğunda
--   unmatched      → iç ürün eşlemesi yok (satılan canlı satır); eşle → kuyrukta
--   ignored        → iptal/iade ama hiç saymadığımız satır; aksiyon gerekmez
--
-- İnceleme kuyruğu = state IN ('return_pending','unmatched') AND resolved_at IS NULL.
--
-- marketplace_orders_enabled: kanal eşleştirme (marketplace_sync_enabled, 0242)
-- flag'inden AYRI. Sipariş çekme + stok yazma RİSKLİ olduğundan ayrı, açık-rıza
-- bir flag arkasında; DEFAULT false. Flag kapalıyken poller/uçlar hiçbir şey yapmaz.
--
-- ADDITIVE: yalnız ekleme + mevcut CHECK genişletme (eski değerler korunur).

BEGIN;

-- ── channel_order_lines: idempotensi defteri ────────────────────────────────
CREATE TABLE channel_order_lines (
  id              bigserial PRIMARY KEY,
  channel         text NOT NULL CHECK (channel IN ('trendyol', 'hepsiburada')),
  order_number    text NOT NULL,
  line_id         text NOT NULL,           -- TY orderLineId (kısmi iptalde satır granülerliği)
  barcode         text,                    -- satır barkodu (eşleme anahtarı)
  product_id      bigint REFERENCES products(id) ON DELETE SET NULL,  -- null = eşleşmemiş
  quantity        integer NOT NULL DEFAULT 0,
  channel_status  text,                    -- son görülen TY ham status'u
  state           text NOT NULL CHECK (state IN (
                    'counted', 'reversed', 'return_pending', 'unmatched', 'ignored'
                  )),
  applied_delta   integer NOT NULL DEFAULT 0,  -- bu satır için iç stoğa net etki (<=0)
  customer_name   text,
  order_date      timestamptz,
  resolved_at     timestamptz,             -- operatör kuyruktan çıkardığında
  resolved_by     bigint REFERENCES users(id),
  raw             jsonb,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, order_number, line_id)
);

-- İnceleme kuyruğu sorgusu (açık return_pending + unmatched).
CREATE INDEX idx_channel_order_lines_review
  ON channel_order_lines (channel, state)
  WHERE resolved_at IS NULL;

-- updated_at otomatik dokunma (0050/0229/0242'deki ortak fonksiyon).
CREATE TRIGGER channel_order_lines_touch_updated_at
  BEFORE UPDATE ON channel_order_lines
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- ── stock_movements: kanal sipariş hareket tipleri ──────────────────────────
-- 0241'deki inline CHECK (stock_movements_type_check) genişletilir; eski değerler
-- (sale/restock/manual_adjustment/return) korunur, iki yeni tip eklenir:
--   channel_sale   → TY siparişi düşümü (-)
--   channel_cancel → TY iptalinde geri ekleme (+)
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN (
    'sale',
    'restock',
    'manual_adjustment',
    'return',
    'channel_sale',
    'channel_cancel'
  ));

-- Kanal hareketini kaynağı olan sipariş satırına bağlar (sale → related_sale_id
-- ikizi). İç POS satışlarında null kalır.
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS related_channel_order_line_id bigint REFERENCES channel_order_lines(id);

-- ── studio_settings: pazaryeri sipariş senkron flag'i (sync flag'inden ayrı) ─
ALTER TABLE studio_settings
  ADD COLUMN IF NOT EXISTS marketplace_orders_enabled boolean NOT NULL DEFAULT false;

COMMIT;
