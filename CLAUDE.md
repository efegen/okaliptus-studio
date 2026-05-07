# CLAUDE.md — Okaliptus Studio Dashboard

Bu dosya Claude ajanlarının her oturumda okuyacağı kısa proje sözleşmesidir. Detay için **birinci kaynak `yoga-studio-dashboard-v1-spec.md`**'dir; çelişki olursa spec kazanır.

## Proje

Tek eğitmenli bir yoga stüdyosu için operasyon ve finans dashboard'u. Spec **v1.5**, üretime hazır, Türkçe. Tek operatör/admin kullanıcı, ders zamanlama, öğrenci borç takibi, ön ödemeli paket sistemi, ürün satışı ve haftalık KPI raporlaması.

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

- **Backend**: `DATABASE_URL`, `PORT=4000`, `TZ=Europe/Istanbul`, `ALLOWED_ORIGINS`, `BOOTSTRAP_ADMINS=user:pass,...`, `BOOTSTRAP_INSTRUCTOR_NAME`, `NODE_ENV`.
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
- Spec v1.4–v1.5 uyumu: rate limit **var**, audit logging UI/akışı **v1 dışı**, MFA/passkey/SSO **v1 dışı**.

## Test

- **Frontend**: Vitest + jsdom, `src/__tests__/`. Setup `src/__tests__/setup.js` (window.matchMedia polyfill, fetch mock).
- **Backend**: smoke testleri `backend/scripts/smoke/NN-*.ts` — reset → migrate → bootstrap → senaryo akışı.
- Yeni feature eklerken: ilgili smoke dosyasını veya yeni numaralı dosya ekle.

## Commit konvansiyonu

Conventional commits. Örnek scope'lar (ingilizce ve açıklamalı): `feat(mobile):`, `fix(pwa):`, `perf(frontend):`, `fix(backend):`, `chore:`, `docs:`.

## v1 kapsamı dışında (önerme)

- Multi-instructor CRUD UI (instructor read-only, seed ile yönetilir).
- Rol bazlı yetkilendirme (3 admin, hepsi her yere).
- Self-service şifre reset, email altyapısı, hesap oluşturma UI.
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
