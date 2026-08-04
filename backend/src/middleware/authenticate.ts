import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AuthenticatedUser } from "../types/express.js";

interface AccessTokenPayload {
  sub: string; // user id
  role: AuthenticatedUser["role"];
  email: string;
}

/**
 * Verifies the short-lived access token and attaches `req.user`.
 *
 * Design choice worth explaining at your defense: the access token is read
 * from the Authorization header (Bearer scheme), NOT from a cookie. Only the
 * *refresh* token lives in an httpOnly cookie. Why split them like this?
 *
 * - The access token needs to be attached to every API call, including ones
 *   made from JS (fetch/axios) — keeping it in memory/header avoids CSRF
 *   entirely for those calls, since an attacker's page can't read it or
 *   attach it to a forged request the way it could with an auto-sent cookie.
 * - The refresh token, by contrast, is rarely sent (only to the /refresh
 *   endpoint) and benefits from httpOnly + Secure + SameSite=Strict so
 *   client-side JS (and therefore XSS) can never read it directly.
 *
 * This is the standard "double-token" pattern: short-lived bearer token for
 * routine calls, long-lived httpOnly-cookie token for the narrow refresh flow.
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: "Access token expired", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ error: "Invalid access token" });
  }
}
