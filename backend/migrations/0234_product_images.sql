-- v1.6 — Ürün görseli yükleme (kendi barındırma).
--
-- Migration 0229'da image_url public bir URL olarak tanımlandı (Trendyol CDN'i
-- doğrudan saklanır, backend dosya host'u yapmaz). Ama Trendyol'da olmayan
-- ürünler için kullanıcının elle URL bulması gerekiyordu. Bu migration, telefonla
-- çekilen fotoğrafın doğrudan kaydedilmesini sağlar: bytes burada, ayrı tabloda.
--
-- Neden ayrı tablo (products kolonu değil):
--   listProducts/getProductById `SELECT *` yapıyor; bytea kolonu products'a
--   eklersek her katalog/POS yüklemesi tüm görselleri JSON'a katar → payload
--   şişer. Ayrı tabloda tutunca hot path (liste) bytes'a hiç dokunmaz; görsel
--   yalnız GET /products/:id/image ile, cache'lenerek servis edilir.
--
-- image_url ile ilişki:
--   Foto yüklenince products.image_url'a `…/products/:id/image?v=<ts>` yazılır
--   (servis katmanı, request host'undan türetir). Böylece tüm <img> tüketicileri
--   değişmeden çalışır. Trendyol ürünleri CDN URL'ini korur; importer COALESCE
--   ile elle yüklenen görseli zaten ezmez (0229).
--
-- Boyut: görsel tarayıcıda ~800x800 WebP'e küçültülüp yüklenir (~30-80KB). bytea
--   limiti CHECK ile 5MB'a sabitlenir (bozuk/aşırı yükleme koruması).

CREATE TABLE product_images (
  product_id  bigint PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  mime        text NOT NULL CHECK (mime IN ('image/webp', 'image/jpeg', 'image/png')),
  bytes       bytea NOT NULL CHECK (octet_length(bytes) > 0 AND octet_length(bytes) <= 5242880),
  byte_size   integer NOT NULL CHECK (byte_size > 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
