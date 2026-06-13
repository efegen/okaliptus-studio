-- v1.6 — Dahili stok takibi (yalnızca elden / POS satış).
--
-- Kapsam DAR: ürün elden satılınca stok düşer; açılış stoğu girilebilir; manuel
-- düzeltme yapılabilir; katalogda stok görünür. Marketplace (Trendyol/Hepsiburada)
-- senkronizasyonu, poller, channel listing KAPSAM DIŞI — bu migration onlara
-- hiç dokunmaz.
--
-- Tasarım: 0007_student_balance_transactions.sql'deki delta-ledger kalıbının
-- BİREBİR ikizidir. Stok bir kolon değil, hareketlerin toplamı (SUM(delta)) olarak
-- türetilir; böylece her değişimin (satış/açılış/düzeltme/iade) izi korunur ve
-- v_student_balances ile aynı şekilde v_product_stock view'ı anlık on_hand verir.
--
-- on_hand kasıtlı olarak eksiye düşebilir: yetersiz stokta dahi satış engellenmez
-- (servis katmanı kararı). Eksi değer "kayıt eksik / açılış stoğu girilmemiş"
-- sinyalidir, hata değil.
--
-- ADDITIVE: yalnız ekleme. Mevcut tablo/kolon drop/alter YOK. Stok takibi
-- studio_settings.stock_tracking_enabled (DEFAULT false) arkasında; flag açılana
-- kadar hiçbir satış/okuma davranışı değişmez.

BEGIN;

-- ── stock_movements: delta-ledger ───────────────────────────────────────────
-- student_balance_transactions ikizi. delta integer (adet); para değil.
--   sale              → satışta otomatik (-quantity), related_sale_id dolu
--   restock           → yeniden tedarik (+)  [şimdilik UI yok, ileriye dönük]
--   manual_adjustment → açılış stoğu + elle düzeltme (setStock; +/-)
--   return            → iade (+)              [şimdilik UI yok, ileriye dönük]
CREATE TABLE stock_movements (
  id               bigserial PRIMARY KEY,
  product_id       bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  delta            integer NOT NULL CHECK (delta <> 0),
  type             text NOT NULL CHECK (type IN (
                     'sale',
                     'restock',
                     'manual_adjustment',
                     'return'
                   )),
  related_sale_id  bigint REFERENCES product_sales(id),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  note             text,
  actor_user_id    bigint REFERENCES users(id),
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_product ON stock_movements (product_id) WHERE deleted_at IS NULL;

-- ── v_product_stock: ürün başına anlık on_hand ──────────────────────────────
-- products LEFT JOIN: hareketi olmayan ürün de satırı ile 0 döner.
CREATE VIEW v_product_stock AS
SELECT
  p.id AS product_id,
  COALESCE(SUM(sm.delta) FILTER (WHERE sm.deleted_at IS NULL), 0)::integer AS on_hand
FROM products p
LEFT JOIN stock_movements sm ON sm.product_id = p.id
GROUP BY p.id;

-- ── studio_settings: stok takibi flag'i ─────────────────────────────────────
ALTER TABLE studio_settings
  ADD COLUMN IF NOT EXISTS stock_tracking_enabled boolean NOT NULL DEFAULT false;

-- ── audit_logs: 'stock_adjusted' action'ı ───────────────────────────────────
-- 0239'daki tam action listesi korunur; yalnız 'stock_adjusted' eklenir.
-- entity_type listesi değişmez: stok düzeltmesi entity_type='product' kullanır
-- (0239'da zaten mevcut). Constraint adı (audit_logs_action_check) korunur.
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
    'stock_adjusted'
  ));

COMMIT;
