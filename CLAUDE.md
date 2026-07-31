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
  - `completed → scheduled` (uncomplete, v1.4): sadece 24 saat içinde + aktif ödeme yokken (kod yalnız `payments`'e bakar; bağlı satış uncomplete'i engellemez — satış borcu ders durumundan bağımsızdır).
- **Borç** = completed lesson (net) + product_sale toplam. Scheduled/cancelled/no_show borç **yaratmaz**. Paket kredisiyle kaplı ders borç yaratmaz.
- **Paket**: `total_amount = credit_count × unit_price` (CHECK constraint). Paket + ilk payment **aynı transaction**. FIFO kredi tahsisi. Advisory lock prefix `student_prepaid_<id>`.
- **Fazla ödeme**: `amount > remaining_debt` → HTTP 409 `OverpaymentNotAllowedError`. Kısmi ödeme serbest. Sistem dışı nakit iadesi operatörün sorumluluğu.
- **İndirim**: yalnız completed + paket-dışı derslerde; `discount_amount ≤ price_snapshot`; brüt fiyat korunur, net türevdir.
- **Düzeltme (yanlış giriş) = sil + yeniden oluştur** (v1.7): kısmi düzenleme yok (ölü `PATCH /product-sales/:id` kaldırıldı). Silme yolları yalnız **Hareketler** ekranından (web+mobil), `requireCan("payments.delete"|"sales.delete"|"packages.delete")` ile kapılı (owner/admin/instructor; asistan hariç — ama asistan ödeme ALIR). Ürün satışı silinince düşülen stok defterden **geri okunup** iade edilir (`sale_cancel` telafi hareketi, `reverseSaleStockMovements`); yeniden patlatma YOK (bundle bileşimi değişmişse sapmaz), flag'den bağımsız. Tahsil edilmiş satış silinemez (409 `DELETE_CONFLICT`; önce ödemeyi sil). Smoke: `40-sale-delete-stock-reversal.ts`, `41-delete-permissions.ts`.
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
- **Asistan kısıtları (kodlandı)**: owner/admin/instructor aynı erişime sahip; yalnız `assistant` kısıtlı. `assistant` GÖRMEZ: finansal KPI/ciro (`/kpi/finance-flow` blok; `/kpi/weekly` + `/kpi/occupancy-flow` finansal alanları soyulur), stüdyo hareketleri (`/movements`), pazaryeri (`/channels`,`/trendyol`,`/mapping`), ayarlar+katalog yazma (PATCH `/settings`, eğitmen/ders türü yazma), öğrenci kalıcı silme (`DELETE /students/:id`), **kayıt düzeltme/silme (`DELETE /payments|/product-sales|/packages/:id` — `*.delete` capability)**, denetim (`/audit-logs`), kullanıcı yönetimi. YAPAR: ders CRUD+yoklama, öğrenci ekle/düzenle, ödeme alma, ürün satışı+kataloğu, takvim, doluluk (ciro gizli). Frontend aynası `src/permissions.js` (`can`/`canSeePage`) + `src/currentUser.jsx` (`useCan`); nav/kart/aksiyon gizleme kozmetik, güvenlik sunucuda. Smoke: `backend/scripts/smoke/38-assistant-restrictions.ts`.
- **Bildirim modülü (config-driven)**: Web Push bildirimleri (ders başlıyor / bayat ders / yeni sipariş) sabit kod DEĞİL — `notification_settings` tablosundan (migration 0258) okunur. `backend/src/services/notification-scheduler.ts` in-process setInterval (`NOTIFICATION_SCHEDULER_MS`, VAPID yoksa başlamaz); config `notification-settings.service.ts`. Ayarlanabilir (Ayarlar → **Bildirimler**, owner-only `notifications.manage`): aç/kapa, KİŞİ-bazlı alıcılar, zamanlama, metin şablonu ({student}/{minutes}/{time}/{customer}/{order}), test-gönder, sessiz saatler. Smoke: `37-notification-scheduler.ts` (davranış), `39-notification-settings.ts` (config).
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
