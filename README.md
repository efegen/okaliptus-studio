# Okaliptus Studio

Internal management dashboard for a yoga studio. Handles students, lessons, payments, and scheduling — built as a single-operator tool with a small admin team.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite, vite-plugin-pwa (Workbox) |
| Backend | Express 4, TypeScript, Node.js 20+ |
| Database | PostgreSQL 17 |
| Hosting | Cloudflare Pages (frontend), Railway (backend + Postgres) |

## Features (v1)

- **Students** — profiles, contact info, lesson records, activity timeline
- **Lesson types** — configurable types with pricing, duration, and instructor assignment
- **Payments** — per-lesson tracking with partial payment support; overpayment is rejected
- **Prepaid packages** — N-credit packages with FIFO credit consumption
- **Discounts** — per-lesson discount applied on top of brut price (net = price − discount)
- **Auth** — username/password login, 3 admin users, 30-day sliding sessions
- **Audit log** — every mutating event (lessons, payments, packages, discounts, settings, lesson-types) tracked with actor user
- **Home dashboard** — weekly calendar view, lesson modal with complete/cancel/pay/discount flows
- **Mobile PWA** — installable to home screen, offline-cached, mobile-first shell with bottom tab nav
- **Settings** — studio-wide configuration stored in the database

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
cd backend && npm run migrate

# 4. Bootstrap (creates instructor and admin accounts from .env)
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
v1.4 additions (uncomplete lesson, audit coverage, DB-level invariants,
auth, KPI end-to-end). 17 files, ~60-90s wall time. The KPI E2E test
(`99-kpi-end-to-end.ts`) is delta-based, so residual data from prior runs
does not invalidate it; for a fully clean run, use `npm run smoke:reset`.

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

- [ ] `ALLOWED_ORIGINS` set on backend (currently mirrors any origin —
      MUST be locked down before public traffic)
- [ ] Login rate limit enabled (5 attempts / 15 min)
- [ ] `VITE_API_BASE_URL` set in Pages build env
- [ ] Cookie `SameSite=None` + `Secure` verified in prod env
- [ ] Backend `npm run smoke:reset` green against staging DB
- [ ] Frontend `npm run test` green
- [ ] Health check endpoint (`/health`) wired to Railway probe

> Live demo: _coming soon_

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
