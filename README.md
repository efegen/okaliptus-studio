# Okaliptus Studio

Internal management dashboard for a yoga studio. Handles students, lessons, payments, and scheduling — built as a single-operator tool with a small admin team.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite |
| Backend | Express, TypeScript, Node.js |
| Database | PostgreSQL |
| Hosting | Railway (backend + DB), Railway static (frontend) |

## Features (v1)

- **Students** — profiles, contact info, lesson records, activity timeline
- **Lesson types** — configurable types with pricing, duration, and instructor assignment
- **Payments** — per-lesson payment tracking with partial payment support
- **Home dashboard** — daily calendar view, upcoming lessons, recent activity
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
npm run bootstrap

# 5. Start dev servers (two terminals)
npm run dev          # Vite frontend on :5173
cd backend && npm run dev  # Express backend on :4000
```

## Project Specification

Full product spec (Turkish): [yoga-studio-dashboard-v1-spec.md](yoga-studio-dashboard-v1-spec.md)

The spec covers data model, API contracts, UI page structure, auth flows, and migration history. Code is the source of truth where spec and implementation diverge — divergences are documented in §11 of the spec.

## Scripts

```bash
npm run migrate          # Run pending SQL migrations
npm run bootstrap        # Seed instructor + admin users from .env
npm run smoke            # Run smoke test suite against local DB
npm run reset-db         # Drop and recreate local DB (dev only)
```

## License

Private — all rights reserved.
