# Intelli-Attach

Geo-verified industrial attachment & logbook platform. See `ROADMAP.md` for
the full phase-by-phase build plan.

## Running locally in VS Code

**Prerequisites:** Node.js 20+, Docker Desktop, VS Code.

### 1. Start the database
```bash
docker compose up -d
```
This starts a PostGIS-enabled Postgres container and auto-runs
`backend/src/db/schema.sql` on first boot (via the `docker-entrypoint-initdb.d`
mount in `docker-compose.yml`). If you change the schema later, you'll need to
run it manually against the running container, since the init script only
fires on a fresh volume:
```bash
docker exec -i intelliattach-db psql -U intelliattach -d intelliattach < backend/src/db/schema.sql
```
Or blow away the volume and let it re-init: `docker compose down -v && docker compose up -d`.

### 2. Backend
```bash
cd backend
cp .env.example .env
# Generate real secrets for JWT_ACCESS_SECRET and JWT_REFRESH_SECRET —
# the command to do this is inside .env.example.
npm install
npm run dev
```
API runs on `http://localhost:4000`. Check `http://localhost:4000/api/health`.

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
App runs on `http://localhost:5173`.

### Why Docker for Postgres instead of a native install?
Native Postgres installs vary in exact PostGIS extension availability and
version across Windows/macOS/Linux, and matching your local Postgres version
to what Supabase/Neon runs in production avoids "works locally, breaks in
prod" surprises. Docker also means `docker compose down -v` gives you a truly
clean slate any time your local DB gets into a weird state — very useful
while you're still iterating on the schema.

## Repo layout
```
intelli-attach/
├── backend/          Express + TypeScript API
│   └── src/
│       ├── config/      env loading, DB pool
│       ├── middleware/  security headers, auth, RBAC, audit logging
│       ├── routes/      route definitions (thin — no logic here)
│       ├── controllers/ request handling + business logic
│       ├── db/          schema.sql, migrations
│       └── types/       shared TS types (e.g. req.user augmentation)
├── frontend/         React + Vite PWA
│   └── src/
│       ├── hooks/       useAuth, useOfflineLogbook (IndexedDB)
│       ├── routes/      ProtectedRoute (client-side UX guard)
│       └── pages/       route-level components
├── docker-compose.yml  Local PostGIS Postgres
└── ROADMAP.md          Phase-by-phase build plan
```
