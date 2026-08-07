import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import type { CorsOptions } from "cors";
import { env } from "../config/env.js";
import { AppError } from "./errorHandler.js";

/**
 * Helmet sets ~15 security-related HTTP headers with one call. The two worth
 * being able to explain individually at your defense:
 *
 * - Content-Security-Policy: restricts which origins scripts/styles/images
 *   can load from, mitigating XSS impact even if an injection slips through.
 * - Strict-Transport-Security (HSTS): tells browsers to only ever talk to
 *   this origin over HTTPS, closing the window for SSL-stripping attacks.
 *   Only meaningful once you're actually deployed on HTTPS (Render gives you
 *   this for free), so it's harmless but inert in local HTTP dev.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Tighten this further once you know your final frontend origin(s).
      connectSrc: ["'self'", ...env.corsAllowedOrigins],
    },
  },
  crossOriginResourcePolicy: { policy: "same-site" },
});

/**
 * CORS allow-list, not a wildcard. A capstone with "*" for CORS alongside
 * cookie-based auth is a red flag an examiner will catch immediately —
 * wildcard origins combined with credentials: true is explicitly disallowed
 * by browsers anyway, so this isn't just best practice, it's a hard
 * constraint once you're sending cookies.
 */
const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser tools (curl, Postman) which send no Origin header.
    if (!origin || env.corsAllowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Using AppError (not a plain Error) here matters: errorHandler.ts
      // reads .statusCode off AppError instances to pick the response
      // status. A plain Error has no statusCode, so it was previously
      // falling through to errorHandler's generic 500 case — even though
      // a rejected CORS origin is really a 403, not a server fault.
      callback(new AppError(`Origin ${origin} not permitted by CORS policy`, 403));
    }
  },
  credentials: true,
};

export const corsMiddleware = cors(corsOptions);

/**
 * Generic API rate limiter — a coarse net for the whole app.
 * The auth routes get a second, stricter limiter layered on top (see
 * auth.routes.ts) because brute-force login attempts need a much tighter
 * ceiling than, say, browsing your own logbook.
 */
export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Rate-limit by IP + attempted email so one abusive IP can't lock out
  // every other user sharing that IP (e.g. campus NAT), while still capping
  // per-account brute force attempts tightly.
  keyGenerator: (req) => `${req.ip}:${(req.body?.email ?? "unknown").toLowerCase()}`,
  message: { error: "Too many authentication attempts, please try again later." },
});