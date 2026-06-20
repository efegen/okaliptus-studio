-- v1.6 — Model C / Faz 2: iç (efektif) stoğu Trendyol'a PUSH (yazma) altyapısı.
--
-- Projenin EN RİSKLİ kısmı: canlı pazaryeri listelerine YAZIYORUZ. Körlemesine
-- push = TY'deki tüm canlı kataloğu sıfırlama riski. Bu migration yalnız İÇ veri
-- modelini (interlock kolonları + log + flag'ler) kurar; dış API'ye hiçbir yazma
-- yapmaz. Asıl yazma stock-push.service + enjekte client'ta, çok katmanlı kilit
-- arkasında (baseline + dry-run + circuit-breaker + change-only + batch-doğrulama).
--
-- KİLİTLER (kodda da uygulanır; bu şema onları DESTEKLER):
--   1) BASELINE INTERLOCK: bir listing "TY'den baseline alınmış" işareti
--      (baselined_at) taşımıyorsa push o satıra yazmayı REDDEDER. baseline_quantity
--      = baseline anındaki TY adedi (referans). Önce toplu baseline operasyonu
--      iç açılış stoğunu TY adediyle hizalar; baseline'sız push imkânsız.
--   7) DEĞİŞMEDİYSE PUSH'LAMA: last_pushed_quantity = son BAŞARIYLA push'lanan adet.
--      Yalnız efektif stok bundan farklıysa push edilir. Başarı DOĞRULANINCA
--      güncellenir; başarısızsa DOKUNULMAZ (retry'lansın, TY spam'lenmesin).
--   8) ASYNC BATCH DOĞRULAMA: last_push_batch_id / last_push_status / last_push_error
--      → batchId poll'lanıp gerçekten uygulandığı DOĞRULANDIKTAN sonra yazılır;
--      başarısızlar (kilitli/arşivli/incelemedeki ürün) GÖRÜNÜR kalır ("push hataları").
--  12) KILL SWITCH + GÖZLEM: marketplace_stock_push_enabled (DEFAULT false) kapalıyken
--      hiçbir yazma olmaz; her push denemesi channel_push_log'a (append-only) yazılır.
--   3) DRY-RUN VARSAYILAN: marketplace_stock_push_dry_run (DEFAULT true) → açık+dry-run
--      yalnız "ne yazılacaktı" logu, TY'ye çağrı YOK. Gerçek yazma ancak dry-run kapanınca.
--
-- ADDITIVE: yalnız nullable kolon + yeni tablo + yeni flag ekleme. Mevcut veri/şema
-- kırılmaz; flag'ler default-off olduğundan açılana kadar hiçbir davranış değişmez.

BEGIN;

-- ── channel_listings: baseline + push durum kolonları ───────────────────────
-- Hepsi nullable / yokluğu "henüz baseline/push yok" anlamına gelir. Yalnız
-- trendyol satırları için anlamlı (HB push yok); kolonlar kanaldan bağımsız durur.
ALTER TABLE channel_listings
  ADD COLUMN IF NOT EXISTS baselined_at          timestamptz,  -- null = baseline YOK → push reddeder
  ADD COLUMN IF NOT EXISTS baseline_quantity     integer,      -- baseline anındaki TY adedi (referans)
  ADD COLUMN IF NOT EXISTS last_pushed_quantity  integer,      -- son BAŞARIYLA push'lanan adet (change-only anahtarı)
  ADD COLUMN IF NOT EXISTS last_pushed_at        timestamptz,  -- son push denemesi/başarısı zamanı
  ADD COLUMN IF NOT EXISTS last_push_batch_id    text,         -- son TY batchRequestId (izlenebilirlik)
  ADD COLUMN IF NOT EXISTS last_push_status      text,         -- son sonuç: success / failed / pending / null
  ADD COLUMN IF NOT EXISTS last_push_error       text;         -- başarısızsa TY'nin döndürdüğü sebep ("push hataları")

-- last_push_status değer alanı (eski satırlar null → serbest). Yeni CHECK,
-- yalnız bu kolona; mevcut UNIQUE/diğer kısıtlar korunur.
ALTER TABLE channel_listings DROP CONSTRAINT IF EXISTS channel_listings_last_push_status_check;
ALTER TABLE channel_listings ADD CONSTRAINT channel_listings_last_push_status_check
  CHECK (last_push_status IS NULL OR last_push_status IN ('success', 'failed', 'pending'));

-- "Push hataları" görünümü + change-only tarama için kısmi index.
CREATE INDEX IF NOT EXISTS idx_channel_listings_push_failed
  ON channel_listings (channel) WHERE last_push_status = 'failed';

-- ── channel_push_log: her push denemesinin append-only kaydı ─────────────────
-- GÖZLEM (#12): dry-run dahil HER deneme buraya düşer (ürün, eski→yeni, batchId,
-- sonuç). channel_listings'teki kolonlar "şu anki durum"; bu tablo TAM geçmiş.
-- mode: dry_run (TY'ye çağrı yok, plan logu) | live (gerçek yazma).
-- result:
--   planned        → dry-run: yazılacaktı (TY çağrısı YOK)
--   submitted      → live: batch gönderildi, sonuç henüz doğrulanmadı
--   success        → live: batch sonucu bu kalemi UYGULADI (doğrulandı)
--   failed         → live: batch sonucu bu kalemi REDDETTİ (sebep error'da)
--   skipped_breaker→ kütlesel-sıfır devre kesici turu durdurdu (yazılmadı)
CREATE TABLE channel_push_log (
  id             bigserial PRIMARY KEY,
  channel        text NOT NULL CHECK (channel IN ('trendyol', 'hepsiburada')),
  listing_id     bigint REFERENCES channel_listings(id) ON DELETE SET NULL,
  product_id     bigint REFERENCES products(id) ON DELETE SET NULL,
  external_id    text NOT NULL,           -- TY barkodu (yazılan/yazılacak anahtar)
  prev_quantity  integer,                 -- last_pushed (push öncesi bizim bildiğimiz TY adedi)
  new_quantity   integer NOT NULL,        -- gönderilen/gönderilecek efektif adet (>= 0)
  delta          integer,                 -- new - prev (gözlem)
  mode           text NOT NULL CHECK (mode IN ('dry_run', 'live')),
  result         text NOT NULL CHECK (result IN (
                   'planned', 'submitted', 'success', 'failed', 'skipped_breaker'
                 )),
  batch_id       text,
  error          text,
  actor_user_id  bigint REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_channel_push_log_listing ON channel_push_log (listing_id, id DESC);
CREATE INDEX idx_channel_push_log_result  ON channel_push_log (result, id DESC);

-- ── studio_settings: stok push flag'leri (sipariş senkronundan AYRI) ─────────
-- marketplace_stock_push_enabled: KILL SWITCH. false → hiçbir push (poller atlar,
--   uçlar 409). DEFAULT false → deploy edilse bile kullanıcı açana kadar yazma yok.
-- marketplace_stock_push_dry_run: DEFAULT true → açık+dry-run yalnız plan logu,
--   TY'ye çağrı YOK. Gerçek yazma ancak operatör bunu bilerek false yapınca.
ALTER TABLE studio_settings
  ADD COLUMN IF NOT EXISTS marketplace_stock_push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketplace_stock_push_dry_run boolean NOT NULL DEFAULT true;

COMMIT;
