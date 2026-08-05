import type { Request, Response, NextFunction } from "express";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { pool } from "../config/db.js";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import { recordAuditEvent } from "../middleware/auditLogger.js";

const REFRESH_COOKIE_NAME = "ia_refresh";

// ----------------------------------------------------------------------------
// Validation schemas — reject malformed input before it touches the DB or a
// password hasher. Cheap to write, closes off a lot of "what if someone
// sends garbage" edge cases for free.
// ----------------------------------------------------------------------------
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  fullName: z.string().min(2),
  role: z.enum(["STUDENT", "ASSESSOR", "ADMIN"]), // note: SUPERVISOR excluded —
  // supervisors never self-register with a password; see magic-link flow.
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ----------------------------------------------------------------------------
// Token helpers
// ----------------------------------------------------------------------------
function signAccessToken(user: { id: string; role: string; email: string }) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
  );
}

function hashToken(rawToken: string): string {
  // SHA-256 is fine here (not argon2/bcrypt) because refresh tokens are
  // already high-entropy random values, not low-entropy human passwords —
  // there's no offline guessing risk to slow down, we just need a one-way
  // map from "raw token the client holds" to "what we stored".
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

async function issueRefreshToken(
  userId: string,
  familyId: string,
  req: Request
): Promise<string> {
  const rawToken = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(
    Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN)
  );

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, hashToken(rawToken), familyId, req.headers["user-agent"] ?? null, req.ip, expiresAt]
  );

  return rawToken;
}

function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return 30 * 24 * 60 * 60 * 1000; // fallback: 30 days
  const [, valueStr, unit] = match;
  const value = Number(valueStr);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return value * unitMs;
}

function setRefreshCookie(res: Response, rawToken: string) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
    path: "/api/auth/refresh", // scope the cookie narrowly — the browser
    // only ever attaches it when calling the refresh endpoint, not on every
    // request to the API.
    maxAge: parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN),
  });
}

// ----------------------------------------------------------------------------
// Controllers
// ----------------------------------------------------------------------------
export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const body = registerSchema.parse(req.body);

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [body.email]);
    if (existing.rowCount) {
      // Same generic message as a real conflict would need — see note in
      // login() about not confirming account existence to unauthenticated
      // callers. Here we DO need to tell the client registration failed,
      // but we avoid confirming *why* isn't leaked beyond "email in use",
      // which is an acceptable, expected disclosure for a signup form.
      throw new AppError("An account with this email already exists", 409);
    }

    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, status)
       VALUES ($1, $2, $3, $4, 'PENDING_VERIFICATION')
       RETURNING id, email, role`,
      [body.email, passwordHash, body.fullName, body.role]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const body = loginSchema.parse(req.body);

    const result = await pool.query(
      `SELECT id, email, password_hash, role, status, failed_login_count, locked_until
       FROM users WHERE email = $1`,
      [body.email]
    );
    const user = result.rows[0];

    // Deliberately identical error for "no such user" and "wrong password".
    // Distinguishing them lets an attacker enumerate valid emails.
    const genericFailure = () => {
      throw new AppError("Invalid email or password", 401);
    };

    if (!user) {
      await recordAuditEvent({
        eventType: "LOGIN_FAILURE",
        req,
        actorEmail: body.email,
        metadata: { reason: "no_such_user" },
      });
      return genericFailure();
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await recordAuditEvent({
        eventType: "LOGIN_FAILURE",
        req,
        actorUserId: user.id,
        actorEmail: user.email,
        metadata: { reason: "account_locked" },
      });
      throw new AppError(
        "Account temporarily locked due to repeated failed attempts. Try again later.",
        423
      );
    }

    const passwordValid = await argon2.verify(user.password_hash, body.password);

    if (!passwordValid) {
      const newFailCount = user.failed_login_count + 1;
      const shouldLock = newFailCount >= env.MAX_FAILED_LOGIN_ATTEMPTS;

      await pool.query(
        `UPDATE users SET failed_login_count = $1,
                          locked_until = $2
         WHERE id = $3`,
        [
          shouldLock ? 0 : newFailCount,
          shouldLock
            ? new Date(Date.now() + env.LOCKOUT_DURATION_MINUTES * 60_000)
            : null,
          user.id,
        ]
      );

      await recordAuditEvent({
        eventType: shouldLock ? "ACCOUNT_LOCKED" : "LOGIN_FAILURE",
        req,
        actorUserId: user.id,
        actorEmail: user.email,
        metadata: { failedAttempts: newFailCount },
      });

      return genericFailure();
    }

    // Success — reset the failure counter, issue tokens.
    await pool.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
       WHERE id = $1`,
      [user.id]
    );

    const familyId = uuidv4();
    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id, familyId, req);
    setRefreshCookie(res, refreshToken);

    await recordAuditEvent({
      eventType: "LOGIN_SUCCESS",
      req,
      actorUserId: user.id,
      actorEmail: user.email,
    });

    res.json({
      accessToken,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!rawToken) throw new AppError("No refresh token provided", 401);

    const tokenHash = hashToken(rawToken);
    const result = await pool.query(
      `SELECT rt.*, u.email, u.role FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash]
    );
    const stored = result.rows[0];

    if (!stored || stored.expires_at < new Date()) {
      throw new AppError("Refresh token invalid or expired", 401);
    }

    if (stored.revoked_at) {
      // Reuse of an already-rotated-out token. This is the classic signal
      // of a stolen refresh token being replayed — respond by nuking the
      // ENTIRE token family, not just this one row, forcing re-login on
      // every device that shares this session lineage.
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [stored.family_id]
      );
      await recordAuditEvent({
        eventType: "TOKEN_REFRESH",
        req,
        actorUserId: stored.user_id,
        metadata: { outcome: "reuse_detected_family_revoked" },
      });
      throw new AppError("Session invalidated due to suspicious activity", 401);
    }

    // Rotate: revoke the presented token, issue a brand new one in the same family.
    await pool.query("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1", [
      stored.id,
    ]);
    const newRawToken = await issueRefreshToken(stored.user_id, stored.family_id, req);
    setRefreshCookie(res, newRawToken);

    const accessToken = signAccessToken({
      id: stored.user_id,
      role: stored.role,
      email: stored.email,
    });

    await recordAuditEvent({
      eventType: "TOKEN_REFRESH",
      req,
      actorUserId: stored.user_id,
      metadata: { outcome: "rotated" },
    });

    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (rawToken) {
      await pool.query(
        "UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1",
        [hashToken(rawToken)]
      );
    }
    res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth/refresh" });

    await recordAuditEvent({
      eventType: "LOGOUT",
      req,
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// Example RBAC-protected, admin-only endpoint.
export async function listUsers(_req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT id, email, full_name, role, status, last_login_at FROM users ORDER BY created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
}
