-- Ref: web sitesi ziyaret istatistikleri (okaliptusyoga.com) → panel "Site" ekranı.
--
-- Site her sayfadan POST /public/pulse'a küçük sinyaller yollar (bkz.
-- services/site-stats.service.ts). ÇEREZ YOK, cihaza hiçbir şey yazılmaz.
--
-- Kişisel veri sınırı (onay bandı gerektirmemesi için; değiştirmeden önce sor):
--   - IP adresi SAKLANMAZ. Bellekte iki iş için kullanılır: ili bulmak ve günlük
--     ziyaretçi anahtarını üretmek.
--   - visitor_key = sha256(o günün tuzu + IP + tarayıcı kimliği). Tuz her gün
--     değişir ve eski günlerin tuzu silinir (site_stat_salts); yani anahtar ertesi
--     gün aynı kişiyi tanımaz ve IP'ye geri çevrilemez.
--   - Konum yalnız İL düzeyindedir (ilçe, koordinat yok).
--   - Reklam tıklama kimlikleri (fbclid, gclid) saklanmaz; yalnız "vardı" bilgisi.
--
-- Ziyaret = aynı ziyaretçi anahtarının 30 dakikadan uzun ara vermeden gezdiği
-- sayfalar. Ham satırlar 90 gün tutulur; günlük özet site_stats_daily'de kalır.

CREATE TABLE site_stat_salts (
  day   date PRIMARY KEY,
  salt  text NOT NULL
);

CREATE TABLE site_visits (
  id             bigserial PRIMARY KEY,
  visitor_key    text        NOT NULL,
  day            date        NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  -- 'instagram_ad' | 'facebook_ad' | 'google_ad' | 'instagram' | 'facebook' |
  -- 'google' | 'bing' | 'yandex' | 'duckduckgo' | 'chatgpt' | 'perplexity' |
  -- 'gemini' | 'claude' | 'copilot' | 'direct' | 'other'
  source         text        NOT NULL,
  referrer_host  text,
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  utm_content    text,
  utm_term       text,
  -- Bağlantıda Meta'nın (fbclid) ya da Google'ın (gclid) tıklama işareti vardı.
  click_mark     text        CHECK (click_mark IN ('meta', 'google')),
  region         text,       -- il; Türkiye dışı ya da bilinmiyorsa NULL
  device         text        NOT NULL CHECK (device IN ('phone', 'tablet', 'desktop')),
  os             text,
  browser        text,
  lang           text,
  screen_w       integer,
  entry_path     text        NOT NULL
);

CREATE INDEX site_visits_day_idx ON site_visits (day);
CREATE INDEX site_visits_started_idx ON site_visits (started_at);
CREATE INDEX site_visits_visitor_idx ON site_visits (visitor_key, last_seen_at DESC);

CREATE TABLE site_pageviews (
  id          bigserial PRIMARY KEY,
  visit_id    bigint      NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,
  -- Sitenin her sayfa açılışında ürettiği rastgele kimlik (yalnız o sayfa
  -- açıkken bellekte durur): sonraki süre/kaydırma sinyalleri buna bağlanır.
  page_id     text        NOT NULL UNIQUE,
  path        text        NOT NULL,
  -- Sayfanın kısa adı (sitenin gönderdiği; panel yolu değil bunu gösterir).
  title       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  -- Sekme öndeyken geçen süre.
  active_ms   integer     NOT NULL DEFAULT 0,
  max_scroll  smallint    NOT NULL DEFAULT 0 CHECK (max_scroll BETWEEN 0 AND 100),
  -- Ekrana giren bölümlerin kimlikleri (ör. 'giris', 'program').
  sections    text[]      NOT NULL DEFAULT '{}',
  -- Sayfanın en büyük içeriğinin çizilme süresi (hız ölçüsü).
  lcp_ms      integer
);

CREATE INDEX site_pageviews_visit_idx ON site_pageviews (visit_id);
CREATE INDEX site_pageviews_started_idx ON site_pageviews (started_at);

CREATE TABLE site_events (
  id           bigserial PRIMARY KEY,
  visit_id     bigint      NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,
  pageview_id  bigint      REFERENCES site_pageviews(id) ON DELETE CASCADE,
  -- 'click' | 'form_open' | 'form_start' | 'form_submit' | 'form_error' |
  -- 'video_play' | 'gallery_open' | 'not_found'
  name         text        NOT NULL,
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX site_events_visit_idx ON site_events (visit_id);
CREATE INDEX site_events_name_idx ON site_events (name, created_at);

-- Günlük özet (ham satırlar silindikten sonra da kalır).
-- dim: 'total' | 'source' | 'path' | 'region' | 'device' | 'campaign'
-- key: boyutun değeri ('total' için ''; 'campaign' için "kampanya / reklam").
CREATE TABLE site_stats_daily (
  day        date    NOT NULL,
  dim        text    NOT NULL,
  key        text    NOT NULL,
  visitors   integer NOT NULL DEFAULT 0,
  visits     integer NOT NULL DEFAULT 0,
  pageviews  integer NOT NULL DEFAULT 0,
  active_ms  bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (day, dim, key)
);

-- Talebin geldiği ziyaretin özeti (kaynak, reklam, il, cihaz, süre, gezilen
-- sayfalar). Form gönderildiği anda kopyalanır; ziyaret satırı 90 gün sonra
-- silinse de talepte kalır.
ALTER TABLE site_inquiries ADD COLUMN origin jsonb;
