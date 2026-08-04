# Intelli-Attach — Project Roadmap

A geo-verified industrial attachment & logbook platform. This roadmap sequences
the build so every phase produces something demoable — useful both for your
own sanity and for progress checkpoints with your supervisor.

## Phase 0 — Environment (Day 1)
- Install: Node.js LTS, Docker Desktop, VS Code + extensions (ESLint, Prettier,
  PostgreSQL by Chris Kolkman, Thunder Client or REST Client).
- Run PostgreSQL + PostGIS locally via Docker (no need to install Postgres
  natively — this avoids version drift between your machine and Render/Supabase).
- Get `docker-compose.yml` up, confirm `psql` connects, confirm PostGIS
  extension loads.

## Phase 1 — Data Layer (Days 2–3)
- Write and run `schema.sql` (provided below).
- Understand every table before moving on — you will be asked about this schema
  at your defense. In particular: why PostGIS `geography` type over plain
  lat/lng floats, why audit tables are append-only, why refresh tokens are
  hashed at rest.
- Seed a few test users per role with a seed script.

## Phase 2 — Backend Auth Core (Days 4–7)
- Express + TypeScript server skeleton (provided below).
- Implement: register/login, password hashing (argon2), JWT access token
  (short-lived, 15 min) + refresh token (long-lived, rotated, stored hashed
  in DB, httpOnly cookie).
- Implement RBAC middleware — route-level and resource-level checks.
- Implement audit logging middleware (every auth event, every privileged
  action) writing to the `audit_log` table.
- Implement rate limiting + account lockout after N failed logins.

## Phase 3 — Supervisor Passwordless Flow (Days 8–9)
- Magic-link generation: single-use, time-boxed (e.g. 30 min), signed token
  stored hashed in a dedicated `magic_links` table (never store the raw token).
- PIN step: supervisor receives a 6-digit PIN via a second channel context
  (email body, separate from the link) to defeat simple link-forwarding.
- Endpoint that consumes the link + PIN together, issues a scoped short-lived
  session token restricted to *approve this logbook entry only* — not a full
  account session.

## Phase 4 — Core Domain: Logbook + Geo-verification (Days 10–14)
- `logbook_entries` table with PostGIS `geography(Point, 4326)` column.
- Endpoint to submit an entry: capture GPS coords client-side, validate
  server-side against the student's registered `attachment_site` using
  `ST_DWithin` (e.g. within 150m radius) before accepting.
- Assessor/Supervisor review endpoints, scoped by RBAC + ownership checks.

## Phase 5 — Frontend PWA (Days 15–20)
- React + Vite scaffold, service worker via Workbox, IndexedDB via `idb` for
  offline entry queuing (student can log entries with no signal; they sync
  when back online).
- Role-aware routing (protected routes per role).
- Geolocation capture UI with graceful fallback/error states.

## Phase 6 — Hardening & Observability (Days 21–23)
- Helmet, CORS allow-list, CSRF strategy for cookie-based refresh flow,
  input validation (zod), centralized error handler that never leaks stack
  traces in production.
- Structured logging (pino), correlate requests with a request-id.

## Phase 7 — Free-Tier Deployment (Days 24–26)
- DB: Supabase free Postgres (has PostGIS enabled by default) or Neon.
- Backend: Render free web service (Node).
- Frontend: Vercel free static/PWA hosting.
- Environment variables via each platform's dashboard — never commit `.env`.
- Cold-start note: Render free tier sleeps after 15 min idle — mention this
  explicitly in your defense as a known limitation, not a bug.

## Phase 8 — Defense Prep (Days 27–28)
- Prepare a threat model doc (STRIDE-lite) for your IAM design.
- Prepare a short "why these decisions" doc: JWT vs session, hashed refresh
  tokens, geofencing radius choice, magic-link + PIN two-channel design.

---
Each phase below this point in our conversation will be built brick-by-brick —
we don't need to write Phase 5 code before Phase 2 is solid. This file is the
map; we won't rush ahead of where your understanding actually is.
