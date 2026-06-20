-- v1.6 — Model C / Faz 1.5: Bundle (set/paket) ürün modeli + türev stok.
--
-- Bundle = birden çok iç üründen oluşan, tek fiyatla satılan paket ürün. KENDİ
-- stoğu YOKTUR; on_hand türevdir: min over components of floor(component_on_hand/qty).
-- Satışta (POS elden + TY siparişi) BİLEŞENLER düşer, bundle DEĞİL ("satışı
-- bileşene patlat"). Bileşen tek başına da satılabilir (paylaşımlı havuz).
--
-- Kurallar (servis + DB birlikte uygular):
--   • İç içe bundle YOK: bir bundle'ın bileşeni kendisi bundle olamaz (tek seviye).
--   • Bundle'a elle setStock ENGELLENİR (bileşeni düzenle).
--   • Tanımlanmamış bundle (is_bundle ama bileşeni yok) TY siparişi → "kurulum
--     bekliyor" kuyruğu (channel_order_lines.state='setup_pending'); decrement yok.
--
-- on_hand HER ZAMAN türetilir; bu migration v_product_stock'u (0241, ham hareket
-- toplamı) KIRMAZ — Faz 1 order-sync + POS hâlâ ham toplama yazar/okur. Bunun
-- üstüne v_product_effective_stock eklenir; ürün okuma yolları buna geçer.
--
-- ADDITIVE: yalnız ekleme + channel_order_lines.state CHECK genişletme (eski
-- değerler korunur).

BEGIN;

-- ── products.is_bundle ──────────────────────────────────────────────────────
-- Bu ürün bir paket mi? Bileşenleri bundle_components'te. is_bundle=false → basit
-- ürün ya da (başka bundle'ın) bileşeni; ham hareket toplamı = on_hand.
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_bundle boolean NOT NULL DEFAULT false;

-- ── bundle_components: bundle → bileşen + adet ──────────────────────────────
-- Her iki yönde de ON DELETE CASCADE: ürün kalıcı silinince (yalnız arşivli,
-- 0235) ilgili bundle eşlemeleri de gider. quantity>0; ürün kendine bileşen olamaz.
CREATE TABLE bundle_components (
  id                   bigserial PRIMARY KEY,
  bundle_product_id    bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity             integer NOT NULL CHECK (quantity > 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bundle_product_id, component_product_id),
  CHECK (bundle_product_id <> component_product_id)
);

CREATE INDEX idx_bundle_components_bundle ON bundle_components (bundle_product_id);
CREATE INDEX idx_bundle_components_component ON bundle_components (component_product_id);

-- ── v_product_effective_stock: gösterilebilir/satılabilir efektif stok ──────
--   is_bundle=false → ham hareket toplamı (v_product_stock.on_hand)
--   is_bundle=true  → min(floor(component_on_hand / qty)); bileşeni yoksa 0
-- numeric bölme + FLOOR: oversold (eksi) bileşende doğru aşağı yuvarlama.
CREATE VIEW v_product_effective_stock AS
SELECT
  p.id AS product_id,
  p.is_bundle,
  CASE
    WHEN p.is_bundle THEN COALESCE((
      SELECT MIN(FLOOR(COALESCE(cs.on_hand, 0)::numeric / bc.quantity))
        FROM bundle_components bc
        JOIN v_product_stock cs ON cs.product_id = bc.component_product_id
       WHERE bc.bundle_product_id = p.id
    ), 0)
    ELSE COALESCE(ps.on_hand, 0)
  END::int AS on_hand
FROM products p
LEFT JOIN v_product_stock ps ON ps.product_id = p.id;

-- ── channel_order_lines: 'setup_pending' state'i ────────────────────────────
-- 0244'teki state CHECK'i genişletilir; eski değerler korunur. Tanımlanmamış
-- bundle TY satırı bu duruma düşer (inceleme kuyruğunda; decrement yok).
ALTER TABLE channel_order_lines DROP CONSTRAINT IF EXISTS channel_order_lines_state_check;
ALTER TABLE channel_order_lines ADD CONSTRAINT channel_order_lines_state_check
  CHECK (state IN (
    'counted',
    'reversed',
    'return_pending',
    'unmatched',
    'ignored',
    'setup_pending'
  ));

COMMIT;
