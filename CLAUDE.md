# CLAUDE.md — Okaliptus Studio Dashboard

Bu dosya Claude ajanlarının her oturumda okuyacağı kısa proje sözleşmesidir. Detay için **birinci kaynak `yoga-studio-dashboard-v1-spec.md`**'dir; çelişki olursa spec kazanır.

## Proje

Tek eğitmenli bir yoga stüdyosu için operasyon ve finans dashboard'u. Spec **v1.5**, üretime hazır, Türkçe. Rol bazlı kullanıcılar (owner/admin/instructor/assistant — bkz. Auth özeti), ders zamanlama, öğrenci borç takibi, ön ödemeli paket sistemi, ürün satışı ve haftalık KPI raporlaması.

## Stack

- **Frontend** (kök `src/`): Vite + React **JSX (TypeScript yok)**, TanStack Query v5 (`src/hooks/queryKeys.js`), plain CSS, manual page routing (React Router yok), `vite-plugin-pwa` + Workbox, mobile shell `src/mobile/` + `useIsMobile`.
- **Backend** (`backend/src/`): Express + **TypeScript strict**, raw `pg` Pool (ORM yok), services pattern (DAO yok — servisler doğrudan `pool.query` çağırır), **opaque session** cookie (JWT değil), bcrypt cost 12.
- **DB**: PostgreSQL, numbered SQL migrations `backend/migrations/0001_*.sql`...
- **Deploy**: Frontend Cloudflare Pages, backend Railway (PostgreSQL sidecar). Backend `0.0.0.0`'a bind eder.

## Repo layout

- Kök = frontend, `backend/` = backend. **Monorepo değil**: her biri kendi `npm install`'ını ister.
- `scripts/` (kök) → asset üretimi (`generate-icons.mjs` vb.).
- `scripts/legacy-css.mjs` → build eklentisi: oklch/color-mix tanımayan tarayıcılar (iOS < 16.2, Chrome < 111) için her CSS'in yanına `.legacy-<hash>.css` üretir; `index.html`'deki küçük kontrol yalnız o tarayıcıda bağlantıyı kopyaya çevirir (ana CSS değişmez, kopya precache dışında). Renkler build'de hesaplanır, değişkenli `color-mix` kapsam başına `--legacy-mix-N` olur. Kaynak CSS'te ek iş yok. Test: `legacy-css.test.js`.
- `backend/scripts/smoke/` → numaralı smoke test dosyaları.
- `backend/migrations/*.sql` → şema kaynağı (tek doğruluk noktası).

## Komutlar

| Yer | Komut | Ne yapar |
|---|---|---|
| Kök | `npm run dev` | Vite dev (5173) |
| Kök | `npm run build` / `preview` | Üretim build → `dist/` |
| Kök | `npm test` / `test:watch` | Vitest + jsdom |
| `backend/` | `npm run dev` | `tsx watch` |
| `backend/` | `npm run db:migrate` | Migration runner — **el ile SQL çalıştırma** |
| `backend/` | `npm run db:bootstrap` | `BOOTSTRAP_ADMINS`'i seed eder |
| `backend/` | `npm run smoke` | Smoke testleri (~60–90 sn) |

## Ortam değişkenleri

- **Backend**: `DATABASE_URL`, `PORT=4000`, `TZ=Europe/Istanbul`, `ALLOWED_ORIGINS`, `BOOTSTRAP_ADMINS=user:pass,...`, `BOOTSTRAP_INSTRUCTOR_NAME`, `BOOTSTRAP_OWNER_USERNAME` (bu kullanıcıyı `owner` rolüne terfi eder, idempotent, asla düşürmez), `NODE_ENV`.
- **Frontend**: `VITE_API_BASE_URL` (opsiyonel).
- `.env` commit edilmez; referans `backend/.env.example`.

## Domain dili

UI metinleri, hata mesajları, kullanıcıya görünen tüm string'ler **Türkçe**. Kod sembolleri İngilizce: API camelCase, DB snake_case. Temel entity'ler:

`student`, `lesson`, `instructor`, `lesson_type`, `prepaid_package`, `payment`, `product_sale`, `discount`, `user`, `session`.

## Kritik invariantlar — kırmadan önce sor

- **Fiyat snapshot**: ders create anında `lesson_type.default_price` kopyalanır. Yalnız iki anda değişir: (a) paket kredisi ile complete'te `package.unit_price` ile override, (b) discount uygulanır. Completed ders snapshot **asla** değişmez.
- **Status transitions**:
  - `scheduled → completed | cancelled | no_show` serbest.
  - `cancelled → completed | no_show` serbest (geç işaretleme).
  - **`completed → cancelled | no_show` YASAK.**
  - `completed → scheduled` (uncomplete, v1.4): sadece 24 saat içinde + ödemesiz + bağlı satış yokken.
- **Borç** = completed lesson (net) + product_sale toplam. Scheduled/cancelled/no_show borç **yaratmaz**. Paket kredisiyle kaplı ders borç yaratmaz.
- **Paket**: `total_amount = credit_count × unit_price` (CHECK constraint). Paket + ilk payment **aynı transaction**. FIFO kredi tahsisi. Advisory lock prefix `student_prepaid_<id>`.
- **Fazla ödeme**: `amount > remaining_debt` → HTTP 409 `OverpaymentNotAllowedError`. Kısmi ödeme serbest. Sistem dışı nakit iadesi operatörün sorumluluğu.
- **İndirim**: yalnız completed + paket-dışı derslerde; `discount_amount ≤ price_snapshot`; brüt fiyat korunur, net türevdir.
- **Para birimi**: yalnız TRY. **Timezone**: Europe/Istanbul, hafta Pazartesi 00:00.

## Migration kuralları

- Sıralı dosyalar: `0001+` schema, `0100+` views, `0200+` seed ve sonradan eklenenler.
- **Eski migration in-place düzenlenmez.** Düzeltme = yeni numaralı dosya.
- Her dosyanın başında ilgili spec bölümü yorum olarak referans verilir.
- Migration tek seferlik uygulanır (`schema_migrations` tablosunda izlenir).

## Auth özet

- Login → `crypto.randomBytes(32).toString('hex')` opaque token → `session` httpOnly cookie. JWT yok.
- 30 gün sliding TTL, server-side revokable.
- Middleware: `backend/src/server/middleware/requireAuth.ts`.
- **Rol sistemi (v1.7)**: `users.role` — 4 sabit rol: `owner` (Geliştirici), `admin` (Yönetici), `instructor` (Yönetici-Eğitmen), `assistant` (Asistan). Rol her istekte `users` satırından canlı okunur (yeniden giriş gerekmez). Yetki kontrolü `backend/src/auth/permissions.ts` (`can(role, capability)`) + `backend/src/server/middleware/requireRole.ts` (`requireRole`/`requireCan`). Kullanıcı yönetimi (`/users` API, yalnız owner) Ayarlar → Kullanıcılar sekmesinden yapılır — Railway'de elle SQL/env işlemi gerekmez. İlk owner `BOOTSTRAP_OWNER_USERNAME` ile terfi eder.
- **Asistan kısıtları (kodlandı)**: owner/admin/instructor aynı erişime sahip; yalnız `assistant` kısıtlı. `assistant` GÖRMEZ: finansal KPI/ciro (`/kpi/finance-flow` blok; `/kpi/weekly` + `/kpi/occupancy-flow` finansal alanları soyulur), stüdyo hareketleri (`/movements`), pazaryeri (`/channels`,`/trendyol`,`/hepsiburada`,`/mapping`), ayarlar+katalog yazma (PATCH `/settings`, eğitmen/ders türü yazma), öğrenci kalıcı silme (`DELETE /students/:id`), denetim (`/audit-logs`), kullanıcı yönetimi. YAPAR: ders CRUD+yoklama, öğrenci ekle/düzenle, ödeme alma, ürün satışı+kataloğu, takvim, doluluk (ciro gizli). Frontend aynası `src/permissions.js` (`can`/`canSeePage`) + `src/currentUser.jsx` (`useCan`); nav/kart/aksiyon gizleme kozmetik, güvenlik sunucuda. Smoke: `backend/scripts/smoke/38-assistant-restrictions.ts`.
- **Bildirim modülü (config-driven)**: Web Push bildirimleri (ders başlıyor / bayat ders / yeni sipariş) sabit kod DEĞİL — `notification_settings` tablosundan (migration 0258) okunur. `backend/src/services/notification-scheduler.ts` in-process setInterval (`NOTIFICATION_SCHEDULER_MS`, VAPID yoksa başlamaz); config `notification-settings.service.ts`. Ayarlanabilir (Ayarlar → **Bildirimler**, owner-only `notifications.manage`): aç/kapa, KİŞİ-bazlı alıcılar, zamanlama, metin şablonu ({student}/{minutes}/{time}/{customer}/{order}/{channel}), test-gönder, sessiz saatler. Cihaz izni (abonelik) Ayarlar → Genel'deki kartta; Ayarlar'ı göremeyen asistan mobil Menü → "Bildirimlere izin ver" anahtarından açar (`src/mobile/MobilePushRow.jsx`, tür seçimi yok); bu cihazda abonelik yoksa açılışta tam sayfa izin ekranı çıkar (`MobilePushPrompt.jsx`, karar tarayıcı aboneliğinden — bayrak yok; "Şimdi değil" yalnız o açılış). Test: `mobile-push-prompt.test.jsx`. **Yeni sipariş gecikmesi ≤ ~1 dk**: pazaryeri poller'ları dakikada bir hafif kontrol yapar (Trendyol son 2 gün tek pencere, Hepsiburada kargoya hazır + paketlenmemiş; `TRENDYOL_NEW_ORDER_POLL_MS` / `HEPSIBURADA_NEW_ORDER_POLL_MS`, 0 → kapalı); yeni `channel_order_sightings` satırı yazılınca `notifyNewChannelOrdersNow` tiki beklemeden gönderir (aynı sessiz saat kuralı, zamanlayıcı kapalıysa no-op) ve tam liste hemen tazelenir. Smoke: `37-notification-scheduler.ts` (davranış), `39-notification-settings.ts` (config).
- **Kullanıcı aktivitesi (owner-only, mobil Menü → Kullanıcılar)**: istemci `useActivityPing` yalnız gerçek etkileşimde (ekran görünürken, en fazla dakikada bir) `POST /activity/ping` atar; `user_activity_days` (migration 0288) günlük giriş sayısı (15 dk ara = yeni giriş) + son etkileşimi tutar, 90 gün saklanır, IP/konum yok. `GET /users/activity` yalnız owner. Çevrimiçi = son 2 dk. Yeni-not bildirimi `note_added` (0287). Smoke: `44-user-activity.ts`.
- **Notlarda kullanıcı etiketi + detay (mobil)**: `@` ile öğrenci (yeşil) veya ekip arkadaşı (turuncu) etiketlenir. Kullanıcı etiketi gövdede ad değil `@{u:<id>}` belirteciyle saklanır, ad okuma anında çözülür (migration 0290, `note_user_mentions`, `note-text.ts`); yanıtta notun yazarı otomatik etiketlenir. Bildirim: kişi başına en fazla bir push — yanıt (`note_reply`) > etiket (`note_mention`) > yeni not (`note_added`). Nota dokunmak tam ekran detay açar. Smoke: `45-note-user-mentions.ts`. **Görüntülenme**: not/yanıt ekranda gerçekten görününce (yarıdan fazlası, ~1 sn, ön planda) `POST /notes/views` ile toplu bildirilir; `note_views` (migration 0291) ilk görülmeyi tutar, yazar sayılmaz, backfill yok. Liste `seen_count`/`seen_by_me` döner, `GET /notes/:id/views` görenleri verir. Yanıtlarda da tepki bırakılır. Smoke: `46-note-views.ts`. **Ana sayfa not destesi** (yalnız istemci, `src/mobile/home/NoteDeck.jsx`): görülmemiş (`seen_by_me`), başkasının yazdığı üst notlar kart destesi; kaydır/"Gördüm"/"Aç" → `POST /notes/views`. Yönetici düzeninde deste KPI hero+pill'lerin yerine geçer, asistanda doluluğun üstünde durur. Test: `src/__tests__/mobile-home-deck.test.jsx`.
- **Trendyol kargo firması değiştirme takibi**: PUT cargo-providers 200 dönse de TY değişikliği ASENKRON uygular. Başarılı PUT sonrası `backend/src/services/trendyol/cargo-change-tracker.ts` (süreç-içi, DB yok) paketi izler; durum siparişin güncel TY firma adından türetilir: `pending → applied | unconfirmed` (10 dk). Liste ve `GET /trendyol/orders/cargo-changes` yanıtları `cargoChange` taşır; istemci `useCargoChangeWatcher` ile bekleyenleri 3 sn'de bir yoklar, sunucu gerekirse `orderNumber` ile hedefli getOrders yapıp snapshot'lara yamar (bayat tam liste çekimi taze firmayı ezmez). TY'nin paket başına 5 dk kuralı bilinçli olarak önceden UYGULANMAZ (ürün kararı): istek her zaman TY'ye gider, reddederse TY'nin hatası gösterilir. Firma whitelist'i `cargo-providers.ts` ↔ `src/marketplaceOrders.js` senkron. Mobil detay siparişi liste önbelleğinden canlı okur (donuk kopya değil). Smoke: `34-trendyol-cargo-provider.ts`; test: `mobile-order-detail-cargo.test.jsx`, `marketplace-orders.test.js`.
- **Pazaryeri özeti (mobil Siparişler üstü, Trendyol + Hepsiburada)**: `GET /channels/insights?period=hafta|ay|gecen` (`finance.read`, salt-okuma) → `backend/src/services/marketplace-insights.service.ts`; iki kanal AYNI biçimi (`ChannelInsights`) üretir, yanıt birleşik özet + `byChannel` + `channels`/`failed` taşır. Listenin kanal filtresi özeti istemcide süzer (`scopeInsights`, yeni istek yok). Bir kanal düşerse diğeriyle döner; HB kimliği yoksa HB dışarıda. Eski `GET /trendyol/insights` (yalnız TY) eski istemciler için duruyor. "Sana kalan" = satış − komisyon − kargo − kesintiler − stopaj(%1) − net KDV (birleşikte KDV toplamdan); ürün alış maliyeti yok, kâr değil. Kayıt TESLİMDEN sonra oluşur → kaydı olmayan siparişin komisyonu satırdaki orandan, kargosu ortalamadan TAHMİN (UI'da "≈"). **Trendyol** (`trendyol/insights.service.ts`): 90 günlük sipariş snapshot'ı + cari hesap ekstresi (settlements / otherfinancials, ≤15 günlük pencereler, 10 dk önbellek). **Hepsiburada** (`hepsiburada/insights.service.ts`): sipariş görünümü + muhasebe kayıtları (`getFinanceTransactions`, ≤1 aylık pencereler, iki ay önceki ayın başından, 10 dk önbellek). HB paket listeleri yalnız SON ~30 GÜNÜ verir → daha eski teslim edilmiş siparişler `Payment` kayıtlarından türetilir (HB SKU → görünümdeki barkod/fotoğraf eşleşmesi). HB oranı KDV hariç, komisyon faturasına %20 KDV eklenir; kargo = `ShipmentCostSharingExpense`, diğer = işlem + ödeme hizmet bedeli; iadeli sipariş ortalamaya girmez. HB her SALI öder: vadesi gelen kayıtların toplamı eksiyse sonraki salıya devreder; hesaba yatan = `TotalPayment` (işaret eksi gelir). Mobil: `src/mobile/ordersInsights/` (şerit + 4 detay katmanı; birleşikte ödeme kanalı etiketli, "Kanallara göre" dökümü); sekmeler şeridin altında yapışkan. Smoke: `48-trendyol-insights.ts`, `53-marketplace-insights.ts`; test: `mobile-orders-insights.test.jsx`.
- **Hepsiburada siparişleri (Trendyol'la aynı ekran)**: `GET /hepsiburada/orders/list` (salt-okuma, `marketplaceSyncEnabled`; kimlik yoksa boş liste, `configured:false`) Trendyol listesiyle AYNI `DisplayOrder` biçimini döner; istemci `useMarketplaceOrders` iki sorguyu (kanal başına ayrı query key) tek listede birleştirir, bir kanal düşerse diğeri görünür. HB'de tek sipariş ucu yok: kargoya hazır (`/packages`, tam veri) → Yeni; kargoda / teslim / teslim edilemedi (ince kayıt; sipariş detayı + paket kargo bilgisi `hepsiburada/orders.service.ts` önbelleğiyle tamamlanır) → Taşıma / Teslim / Yeniden; iptal → Tümü. Sekme paketin geldiği listeden türetilir. Tarih sorgusu `yyyy-MM-dd HH:mm` (İstanbul). Barkod = paketin HB kargo barkodu (`cargoTrackingNumber`, istemci Code128). İade talebi (`Claim…`) → `returnRequested`, Teslim'de kalır, "Müşteri iade talebi açtı". Yeni sipariş push'u `channel_order_sightings` (kanal `hepsiburada`) + şablonda `{channel}` (0295). Poller `HEPSIBURADA_ORDER_POLL_MS` (3 dk). **Kargo firması değiştirme** yalnız paketlenmiş, kargoya verilmemiş pakette (HB diğerlerinde 409 → `CARGO_NOT_CHANGEABLE`): seçenekler pakete göre HB'den (`GET /hepsiburada/orders/cargo-options`), yazma `POST /hepsiburada/orders/cargo-company` (`marketplaceFulfillmentEnabled`; kod HB'nin canlı listesinde değilse 422), takip Trendyol'un `CargoChangeTracker` sınıfının HB örneği (`hepsiburada/cargo-change.ts`, firma adına göre) + `GET /hepsiburada/orders/cargo-changes`. SIT'te değiştirme/bölme/bozma `DeliveryNotFound` verir (HB test ortamı hatası). Kimlik: `HEPSIBURADA_ENV=prod`, Merchant ID, servis anahtarı, User-Agent = panelde yetkili entegratör adı. Script: `npm run hb:live-check` (yalnız GET), `npm run hb:sit` (yalnız SIT). Smoke: `51-hepsiburada-orders-list.ts`, `52-hepsiburada-cargo-company.ts`; test: `mobile-orders-hepsiburada.test.jsx`.
- **Canlı senkron (sayfalar ve kullanıcılar arası)**: başarılı her yazmadan (2xx POST/PUT/PATCH/DELETE) sonra `apiRequest` etkilenen sorguları TEK merkezden tazeler (`src/hooks/writeInvalidation.js` → `queryKeysForWrite`; ekranlardaki eski invalidate'ler zararsız). Sunucu aynı yazmayı `GET /live` SSE akışıyla açık istemcilere sinyal olarak yayınlar (`backend/src/services/live-sync.service.ts`, `publishWrites` middleware): sinyal VERİ TAŞIMAZ (`{seq, method, path}`), istemci (`src/hooks/useLiveSync.js`) aynı eşlemeyle tazeler — bildirim yok, sessiz. Kök listesi sunucu `signalCapability` ↔ istemci `queryKeysForWrite` senkron tutulmalı; notlar/Trendyol/kullanıcı/push/aktivite bilinçli olarak dışarıda. Rol süzgeci: pazaryeri `marketplace.manage`, etkinlik günü `events.day.read`. Kendi yazmamızın sinyali yutulur (istek atılırken not edilir). Ekran gizlenince bağlantı kapanır, dönüşte `?since=<instance>:<seq>` ile kaçırılanlar tekrar oynatılır; olmazsa (deploy, 200 sinyallik tampon taştı) senkron edilen her şey bir kez tazelenir. 25 sn ping, 60 sn sessizlikte yeniden bağlanma, kullanıcı başı 3 / toplam 30 akış, çıkış/düşen oturum akışı kapatır. **Tek süreç varsayımı**: yayın süreç içi; Railway'de ikinci kopya açılırsa LISTEN/NOTIFY gerekir. Dev proxy'de `live` kökü `vite.config.js`'te. Smoke: `47-live-sync.ts`; test: `write-invalidation.test.js`, `live-sync.test.js`.
- **Web sitesi mağazası (okaliptusyoga.com/magaza)**: site yalnız Trendyol üzerinden satar; ürün listesini build sırasında `GET /site/products` ucundan okur. Oturum yok: `SITE_FEED_TOKEN` (en az 32 karakter) `Authorization: Bearer` ile sabit sürede karşılaştırılır, anahtar yoksa uç 404; 15 dk'da 30 istek, önbellek ve CORS yok. Kaynak `channel_products` snapshot'ı (model koduna göre gruplu, kimlik model kodunun özeti); yalnız Trendyol'da herkese açık alanlar döner (ad, en düşük fiyat, indirimdeyse liste fiyatı, seçenek sayısı, stokta mı, ilk görsel, ilan linki, köşe). Linkler yalnız trendyol.com, görseller yalnız dsmcdn.com ise geçer. Site ayarları `site_products` (0292): gizle, köşe (`arinma`/`meditasyon`/`taslar`/`pratik`; boşsa başlıktan tahmin), site adı. Yönetim: Ürünler → "Site mağazası" (`src/siteStore.jsx`, `GET/PATCH /site-products`, `marketplace.manage`). Otomatik yenileme (`site-refresh.service.ts`, saatte bir; `SITE_REFRESH_CHECK_MS=0` kapatır): Trendyol listesi `SITE_SYNC_INTERVAL_HOURS`'tan (24) eskiyse aynı salt-okuma senkronunu çalıştırır, ilk sayfa boş gelirse hiçbir şey yazmaz; sitenin listesinin parmak izi değişince `SITE_DEPLOY_HOOK_URL`'ye (yalnız Cloudflare Pages deploy hook, loglanmaz) haber verir, başarısızsa sonraki bakışta yeniden dener, boş listede haber vermez; durum `site_feed_state` (0293). Smoke: `49-site-feed.ts`, `50-site-refresh.ts`; test: `site-store.test.jsx`.
- **Web sitesi formları → Talepler (0296; mobil ekranlar var, masaüstü yok)**: sitenin üç formu (`contact` Bize ulaşın, `lesson` ders talebi, `camp` etkinlik ön kaydı) `POST /public/inquiries`'e gider → `site_inquiries`. Oturumsuz, çerezsiz; panelin CORS/CSRF katmanından ÖNCE kendi Origin listesiyle bağlanır (`okaliptusyoga.com` + `www` her zaman, ekler `SITE_FORM_ORIGINS`; site adresi `ALLOWED_ORIGINS`'e GİRMEZ). İlke: gerçek form kaybolmaz. Yalnız eksik ad / 7–15 haneli olmayan telefon / bilinmeyen form 422 (alan mesajlı); uzun metin kırpılır, e-posta reddedilmez. Şüpheli (`suspect_reason`: tuzak alan `trap`, `SITE_FORM_MIN_FILL_MS` altında `too_fast`, Origin yok, IP başına 10 dk'da 5'ten sonrası `burst`, Turnstile başarısız `captcha`) REDDEDİLMEZ: kaydedilir, bildirimsiz; yanıt her başarılı yolda aynı (201 `{received:true}`). Sert sınır IP başına 10 dk'da 20 / günde 60 → 429. Günlük temiz tavan `SITE_FORM_DAILY_LIMIT` (200) → 503 `BUSY` + alıcılara günde bir uyarı; şüpheli tavanı (100) temizi etkilemez, aşınca şüpheli sessizce düşer. Tekrar: aynı `client_id` yeni satır açmaz; aynı telefon (son 10 hane, `phone_key`) + tür (+ kampta etkinlik) 24 saat içinde → ayrı satır, `duplicate_of` ile bağlı, bildirimsiz. Turnstile isteğe bağlı (`TURNSTILE_SECRET_KEY`; Cloudflare'e ulaşılamazsa temiz sayılır). Kapatma: `SITE_FORMS_ENABLED=false` → 404. Bildirim `site_inquiry` (0296 seed: owner+admin+instructor; `{title}`/`{name}`/`{summary}`/`{message}`), anlık `notifySiteInquiriesNow` + tik yedeği, claim `notified_at`, son 2 gün, 3'ten fazlası tek özet; sessiz saatlerde ertelenir. Canlı senkron kökü `site-inquiries` (yetki `inquiries.manage`: owner/admin/instructor, asistan kararı açık). Panel uçları (requireAuth + `inquiries.manage`): `GET /site-inquiries?box=new|contacted|done|suspect|spam|all&kind=&limit=&before=`, `GET /site-inquiries/counts`, `GET /site-inquiries/:id` (`submissions`: kendi gönderimleri; `related`: aynı telefondan DİĞER baş satırlar; telefonu eşleşen öğrenci `student`), `PATCH /site-inquiries/:id` (`status`, `note`, `suspect:false`; durum değişince `handled_by`/`handled_at`). Tekrar gönderimler (`duplicate_of` dolu) liste ve sayaçlarda ayrı satır değildir: baş satır `submissionCount` taşır ve EN SON gönderimin bilgilerini gösterir. Bildirim adresi `/?talep=<id>` (özet ve tavan uyarısı `/?talepler=1`); `public/push-sw.js` açık pencereye `push:open` mesajı yollar, `MobileApp` adresi okuyup temizler. **Mobil** (`src/mobile/inquiries/`, tasarım "Studio Talepler mobil" canvas'ı): ana sayfanın sağ üstünde profil harfi yerine gelen kutusu düğmesi + yeni sayısı rozeti (yetkisiz rolde profil menüsü kalır); sayfalar `inquiries` (Yeni / Dönüş yapıldı / Tamamlanan sekmeleri, tür çipleri, gün grupları, şüpheli satırı), `inquiry-detail` (tam ekran: Ara/WhatsApp/E-posta, bilgiler, gönderimler, kayıtlı öğrenci → profil, diğer talepler, odaktan çıkınca kaydedilen not, durum çubuğu + ⋯ menüsü), `inquiry-suspects` (Gerçek → `suspect:false`, Spam geri alınabilir). "Etkinliğe ekle" / "Öğrenci olarak ekle" ilk etapta YOK (kullanıcı kararı). Sorgular `siteInquiries` öneki altında; `writeInvalidation.js` + `SYNCED_QUERY_KEYS` + dev proxy'de `site-inquiries` kökü. Ayarlar → Bildirimler'de "Yeni site talebi" satırı. Smoke: `54-site-inquiries.ts`; test: `mobile-inquiries.test.jsx`.
- **Cloudflare geçişi — DNS/Cloudflare adımından ÖNCE oku (kullanıcı: "asla unutulmayacak şekilde")**: sitenin formları ve panel `api.okaliptusyoga.com`'a (Railway) bağlı. (1) Site canlıya çıkmadan bu repo push edilmiş olmalı, yoksa formlar yalnız "Gönderilemedi" + telefon gösterir. (2) DNS taşınırken `api` CNAME'i birebir kopyalanır ve **DNS only (gri bulut)** kalır; Cloudflare içe aktarırken CNAME'leri proxied yapabilir, tek tek bakılmalı. (3) `api` bir gün turuncu bulut olursa: istemci IP'si zaten doğru okunur (`backend/src/server/middleware/clientIp.ts`: `req.ip` Cloudflare'in yayımladığı aralıktaysa `CF-Connecting-IP`, değilse başlık yok sayılır; IP okuyan her şey, giriş sınırı dahil, bunu kullanır; smoke `55-client-ip.ts`), ama SSL/TLS **Full (strict)** olmalı ve `api`'ye **Bot Fight Mode / challenge uygulanmamalı** (fetch istekleri doğrulama ekranını çözemez, form ve panel bozulur). Cloudflare IP aralıkları değişirse liste güncellenir. (4) `*.pages.dev` önizlemesinden form denemek için o adres `SITE_FORM_ORIGINS`'e eklenir. (5) Railway'de ikinci kopya açılmaz (canlı senkron, zamanlayıcılar, bellek içi istek sınırları tek süreç varsayar). (6) Canlıdan sonra her formdan bir gerçek deneme, telefona push geldiğine bakılır, denemeler Spam'e alınır.
- Spec v1.4–v1.7 uyumu: rate limit **var**, audit logging UI/akışı **v1 dışı**, MFA/passkey/SSO **v1 dışı**.

## Test

- **Frontend**: Vitest + jsdom, `src/__tests__/`. Setup `src/__tests__/setup.js` (window.matchMedia polyfill, fetch mock).
- **Backend**: smoke testleri `backend/scripts/smoke/NN-*.ts` — reset → migrate → bootstrap → senaryo akışı.
- Yeni feature eklerken: ilgili smoke dosyasını veya yeni numaralı dosya ekle.

## Commit konvansiyonu

Conventional commits. Örnek scope'lar (ingilizce ve açıklamalı): `feat(mobile):`, `fix(pwa):`, `perf(frontend):`, `fix(backend):`, `chore:`, `docs:`.

## v1 kapsamı dışında (önerme)

- Multi-instructor CRUD UI (instructor read-only, seed ile yönetilir).
- Self-service şifre reset (owner panelden başkasının şifresini sıfırlar), email altyapısı.
- WebAuthn/passkey, MFA, SSO/OAuth.
- Öğrenci-bazlı veya mode-bazlı fiyatlandırma.
- Paket iptali / kredi iadesi (manuel operatör süreci).
- Takvim drag&drop / lesson yeniden zamanlama.
- "Kompliman ders" ayrı flag — discount ile modellenir.
- Audit logging UI.
- Çoklu para birimi.

## Dokunmadan önce kontrol

- `dist/`, `node_modules/` üretilen — düzenleme.
- `public/` altındaki PWA ikonları `scripts/generate-icons.mjs` ile üretilir; **el ile düzenleme yok**.
- `backend/migrations/*.sql` mevcut dosyalar **in-place düzenlenmez**.
- `.env` commit yasak (`.env.example` referans).
