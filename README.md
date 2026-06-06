# Okaliptus Studio

Internal management dashboard for a yoga studio. Handles students, lessons, payments, prepaid packages, and a product catalog — built as a single-operator tool with a small admin team.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite, TanStack Query, vite-plugin-pwa (Workbox) |
| Backend | Express 4, TypeScript, Node.js 20+ |
| Database | PostgreSQL 18 |
| Hosting | Cloudflare Pages (frontend), Railway (backend + Postgres) |

## Features

- **Students** — profiles, contact info, lesson records, A11 activity timeline (Summary / Lessons / Sales / Movements tabs); permanent (cascade) hard-delete alongside soft archive
- **Lesson types & instructors** — configurable lesson types (pricing, duration); full instructor CRUD, all audited
- **Payments** — per-lesson tracking with partial payment support; overpayment is rejected
- **Product catalog & sales** — persistent catalog (barcode, price, self-hosted image, marketplace listing URLs, variants/category) with item-based cart sales and per-item price snapshots; Trendyol Excel import
- **Prepaid packages** — N-credit packages with FIFO credit consumption
- **Discounts** — per-lesson discount applied on top of brut price (net = price − discount)
- **Auth** — username/password login, 3 admin users, 30-day sliding sessions, login rate limit; login/logout written to the audit log
- **Audit log** — every mutating event (lessons, payments, packages, discounts, settings, lesson-types, instructors, products, auth login/logout) tracked with actor user
- **Home dashboard** — weekly calendar view, lesson modal with complete/cancel/pay/discount flows
- **Movements** — studio-wide chronological activity feed (sales / lessons / payments) with filters and summary
- **Mobile PWA** — installable to home screen, offline-cached, mobile-first shell with bottom tab nav
- **Settings** — studio-wide configuration plus an Activity (audit) tab

## Local Setup

**Prerequisites:** Node.js 20+, PostgreSQL 14+

```bash
# 1. Install dependencies
npm install
cd backend && npm install && cd ..

# 2. Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env — set DATABASE_URL, PORT, TZ

# 3. Run migrations
cd backend && npm run db:migrate

# 4. Bootstrap (creates admin accounts, and a first instructor if none exists, from .env)
cd backend && npm run db:bootstrap && cd ..

# 5. Start dev servers (two terminals)
npm run dev          # Vite frontend on :5173
cd backend && npm run dev  # Express backend on :4000
```

## Project Specification

Full product spec (Turkish): [yoga-studio-dashboard-v1-spec.md](yoga-studio-dashboard-v1-spec.md)

The spec covers data model, API contracts, UI page structure, auth flows, and migration history. Code is the source of truth where spec and implementation diverge — divergences are documented in §11 of the spec.

## Scripts

### Backend (run from `backend/`)

```bash
npm run db:migrate       # Run pending SQL migrations
npm run db:bootstrap     # Seed instructor + admin users from .env

# Smoke test paketi (service-layer integration)
npm run smoke            # Run all smoke tests (sequential)
npm run smoke -- --bail  # Stop at first failure (CI mode)
npm run smoke -- --only 11,99   # Run specific files
npm run smoke:single -- 11      # Same, alias
npm run smoke:reset      # Reset DB → migrate → bootstrap → run all (full clean run)
```

### Frontend (run from repo root)

```bash
npm run dev              # Vite dev server (port 5173)
npm run build            # Production build to dist/
npm run preview          # Serve built artifacts

# Frontend smoke (Vitest + React Testing Library)
npm run test             # Run all *.test.{js,jsx} once
npm run test:watch       # Watch mode for TDD
npm run test:ui          # Vitest browser UI
```

## Test Coverage

The project ships with two parallel smoke layers:

**Backend smoke** (`backend/scripts/smoke/`) — direct service-layer
integration tests against a local Postgres. Covers spec §7 scenarios plus
later additions (uncomplete lesson, audit coverage, DB-level invariants,
auth, KPI end-to-end, product catalog & cart sale, product image,
student hard-delete, studio movements). 21 files,
~60-90s wall time. The KPI E2E test (`99-kpi-end-to-end.ts`) is
delta-based, so residual data from prior runs does not invalidate it;
for a fully clean run, use `npm run smoke:reset`.

**Frontend smoke** (`src/__tests__/`) — Vitest + React Testing Library
component-level tests with mocked `fetch`. Covers login form, API client
behavior (401 dispatch, credential cookies), students list, student
profile, home dashboard, auth gating, mobile viewport switching. 7 files,
runs in <5s.

Pre-deploy verification:

```bash
# 1. Backend (full clean run)
cd backend && npm run smoke:reset

# 2. Frontend
cd .. && npm run test

# 3. Manual browser smoke
npm run dev   # backend in another terminal
```

If all three are green, v1 is production-ready modulo deploy hygiene —
CORS whitelist, env vars, custom domain — covered in the Deployment
section.

## Deployment

Production setup:

- **Frontend:** Cloudflare Pages (free tier). Build command `npm run build`,
  output directory `dist/`. SPA fallback via `public/_redirects`
  (`/*  /index.html  200`). Build-time env: `VITE_API_BASE_URL`
  (production API origin).
- **Backend + DB:** Railway (~$5/mo, Express + Postgres in one project).
  Custom domain `api.<your-domain>` to share eTLD+1 with the frontend
  (allows `SameSite=None` session cookies).

Pre-deploy checklist:

- [ ] `ALLOWED_ORIGINS` set on backend (CORS is fail-secure — with no
      value, production rejects all cross-origin requests, so this MUST
      be set to the frontend origin)
- [ ] Login rate limit enabled (5 attempts / 15 min)
- [ ] `VITE_API_BASE_URL` set in Pages build env
- [ ] Cookie `SameSite=None` + `Secure` verified in prod env
- [ ] Backend `npm run smoke:reset` green against staging DB
- [ ] Frontend `npm run test` green
- [ ] Health check endpoint (`/health`) wired to Railway probe

### Backups

- **Manual:** `cd backend && npm run db:backup` — `pg_dump` (custom
  format) to `backend/backups/`, with local retention
  (`BACKUP_KEEP_DAYS`, default 14). Requires a PG 18 client.
- **Nightly (active):** [.github/workflows/db-backup.yml](.github/workflows/db-backup.yml)
  runs a nightly `pg_dump` (via Docker `postgres:18`) at 00:00
  Europe/Istanbul, GPG-encrypts it (AES-256), verifies it decrypts and
  `pg_restore --list`s cleanly, then uploads it as a GitHub Actions
  artifact (30-day retention). The repo is public, so the dump is
  **always encrypted before upload** — the artifact is useless without
  `BACKUP_PASSPHRASE`. Repo secrets required: `DATABASE_URL` (Railway
  public host) and `BACKUP_PASSPHRASE`. **Store the passphrase in a
  password manager — if lost, every artifact is unrecoverable.** Restore
  steps are in the workflow header comment. Trigger on demand from the
  Actions tab ("Run workflow") or `gh workflow run db-backup.yml`.

## PWA Installation

The app ships as a Progressive Web App. After deploying, users can install it
to their home screen for an app-like experience (standalone window, custom
icon, offline cache).

- **iOS Safari:** Share menu → "Add to Home Screen" (Ana Ekrana Ekle)
- **Android Chrome:** Menu → "Install app" (Uygulamayı yükle)

PWA assets live in [public/](public/): `pwa-192.png`, `pwa-512.png`,
`pwa-512-maskable.png`, `apple-touch-icon.png`, `favicon.svg`. They are
placeholders (terracotta circle + white "O") generated by
[scripts/generate-pwa-icons.mjs](scripts/generate-pwa-icons.mjs); replace
the drawing logic there and re-run `node scripts/generate-pwa-icons.mjs`
when the real logo is ready.

## License

Private — all rights reserved.
