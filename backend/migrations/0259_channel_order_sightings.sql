-- Ref: bildirim modülü (0257) — "yeni sipariş" bildirimini stok senkronundan
-- (marketplace_orders_enabled) BAĞIMSIZ hale getirir. channel_order_lines yalnız
-- stok flag'i açıkken dolan bir defterdi; stok fazı kapalıyken (varsayılan, ve UI'dan
-- gizli) hiç dolmadığı için "yeni sipariş" bildirimi asla tetiklenmiyordu — sipariş
-- Siparişler ekranında (salt-okunur, marketplace_sync_enabled) görünse bile.
--
-- Bu tablo o salt-okunur sipariş listesi akışından (orders.service.ts) beslenir —
-- stoğa/ürüne dokunmaz, yalnız "bu siparişi gördük" damgasını tutar.
CREATE TABLE channel_order_sightings (
  channel       text NOT NULL CHECK (channel IN ('trendyol', 'hepsiburada')),
  order_number  text NOT NULL,
  customer_name text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, order_number)
);
