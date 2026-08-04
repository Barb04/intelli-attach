-- ============================================================================
-- Intelli-Attach — Core Schema
-- Target: PostgreSQL 14+ with PostGIS extension (Supabase/Neon free tier both
-- support this; enable via `CREATE EXTENSION postgis;` — the platform admin
-- roles on Supabase/Neon are already allowed to do this, unlike some managed
-- Postgres providers that restrict extensions).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gives us gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email columns

-- ----------------------------------------------------------------------------
-- ENUM TYPES
-- Using enums instead of free-text role columns closes off an entire class of
-- privilege-escalation bugs: you cannot insert 'Admln' by typo and you cannot
-- forget to validate a role string in application code — the DB rejects it.
-- ----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('STUDENT', 'ASSESSOR', 'SUPERVISOR', 'ADMIN');
CREATE TYPE account_status AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION');
CREATE TYPE logbook_status AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'FLAGGED');
CREATE TYPE audit_event AS ENUM (
  'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'TOKEN_REFRESH',
  'PASSWORD_CHANGE', 'ROLE_CHANGE', 'ACCOUNT_LOCKED',
  'MAGIC_LINK_ISSUED', 'MAGIC_LINK_CONSUMED', 'MAGIC_LINK_EXPIRED',
  'LOGBOOK_SUBMITTED', 'LOGBOOK_APPROVED', 'LOGBOOK_REJECTED',
  'GEOFENCE_VIOLATION'
);

-- ----------------------------------------------------------------------------
-- USERS
-- Only Student, Assessor, and Admin get full accounts with passwords.
-- Industry Supervisors are intentionally NOT full accounts by default — see
-- magic_links below. This is a deliberate attack-surface reduction: a
-- supervisor who never authenticates with a password cannot leak a password.
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             CITEXT UNIQUE NOT NULL,   -- case-insensitive email compare
  password_hash     TEXT,                     -- NULL for supervisor-only rows
  full_name         TEXT NOT NULL,
  role              user_role NOT NULL,
  status            account_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  failed_login_count SMALLINT NOT NULL DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT password_required_for_full_accounts
    CHECK (role = 'SUPERVISOR' OR password_hash IS NOT NULL)
);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);

-- ----------------------------------------------------------------------------
-- ATTACHMENT SITES (the physical company location, geofenced)
-- ----------------------------------------------------------------------------
CREATE TABLE attachment_sites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name  TEXT NOT NULL,
  address       TEXT,
  location      GEOGRAPHY(POINT, 4326) NOT NULL, -- WGS84 lat/lng, meters-aware
  geofence_radius_m INTEGER NOT NULL DEFAULT 150,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sites_location ON attachment_sites USING GIST (location);

-- ----------------------------------------------------------------------------
-- STUDENT ATTACHMENTS (links a student to a site, and to their supervisor)
-- ----------------------------------------------------------------------------
CREATE TABLE attachments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  site_id           UUID NOT NULL REFERENCES attachment_sites(id),
  supervisor_email  CITEXT NOT NULL, -- supervisor may not have a users row yet
  supervisor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date > start_date)
);
CREATE INDEX idx_attachments_student ON attachments(student_id);
CREATE INDEX idx_attachments_supervisor_email ON attachments(supervisor_email);

-- ----------------------------------------------------------------------------
-- LOGBOOK ENTRIES — the geo-verified core artifact
-- ----------------------------------------------------------------------------
CREATE TABLE logbook_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id     UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  entry_date        DATE NOT NULL,
  narrative         TEXT NOT NULL,
  submitted_location GEOGRAPHY(POINT, 4326) NOT NULL,
  distance_from_site_m NUMERIC(10, 2), -- computed at insert time, cached for audit
  within_geofence   BOOLEAN NOT NULL,
  status            logbook_status NOT NULL DEFAULT 'DRAFT',
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  review_comment    TEXT,
  created_offline   BOOLEAN NOT NULL DEFAULT false, -- true if synced from IndexedDB queue
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attachment_id, entry_date) -- one entry per student per day
);
CREATE INDEX idx_logbook_attachment ON logbook_entries(attachment_id);
CREATE INDEX idx_logbook_status ON logbook_entries(status);
CREATE INDEX idx_logbook_location ON logbook_entries USING GIST (submitted_location);

-- ----------------------------------------------------------------------------
-- REFRESH TOKENS
-- We store a SHA-256 hash of the refresh token, never the token itself — the
-- same principle as password storage. If the DB leaks, the tokens inside it
-- are useless without also knowing the original random value.
-- Rotation: every refresh issues a new token and invalidates the old row
-- (revoked_at set), giving us reuse-detection — if a revoked token is
-- presented again, that's a strong signal of theft and we can nuke the
-- whole session family.
-- ----------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  family_id     UUID NOT NULL, -- shared across a rotation chain
  user_agent    TEXT,
  ip_address    INET,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_family ON refresh_tokens(family_id);

-- ----------------------------------------------------------------------------
-- MAGIC LINKS — passwordless supervisor approval
-- token_hash: SHA-256 of the random link token (never store raw).
-- pin_hash: bcrypt/argon2 hash of the 6-digit PIN delivered via a second
--           channel context, so a leaked link alone is not enough.
-- scope: restricts what the resulting session can do (e.g. "approve one
--        specific logbook_entry id") rather than granting a full account.
-- ----------------------------------------------------------------------------
CREATE TABLE magic_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_email CITEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  pin_hash      TEXT NOT NULL,
  scope_type    TEXT NOT NULL,     -- e.g. 'LOGBOOK_APPROVAL'
  scope_ref_id  UUID NOT NULL,     -- e.g. logbook_entries.id
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  max_attempts  SMALLINT NOT NULL DEFAULT 5,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_magic_links_email ON magic_links(supervisor_email);

-- ----------------------------------------------------------------------------
-- AUDIT LOG — append-only. No UPDATE, no DELETE from application code.
-- We enforce this with a trigger below rather than trusting every future
-- developer (including future-you) to remember the rule.
-- ----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  event_type    audit_event NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email   CITEXT, -- captured even if actor_user_id is null (e.g. failed login on unknown email)
  ip_address    INET,
  user_agent    TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_actor ON audit_log(actor_user_id);
CREATE INDEX idx_audit_event_type ON audit_log(event_type);
CREATE INDEX idx_audit_created_at ON audit_log(created_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

CREATE TRIGGER trg_audit_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- ----------------------------------------------------------------------------
-- updated_at auto-touch trigger, applied to mutable tables
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_logbook_touch BEFORE UPDATE ON logbook_entries
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
