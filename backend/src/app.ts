import express from "express";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import { securityHeaders, corsMiddleware, generalRateLimiter } from "./middleware/security.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { logbookRouter } from "./routes/logbook.routes.js";
import { magiclinkRouter } from "./routes/magiclink.routes.js";

export function createApp() {
  const app = express();

  // Render/Railway/most free-tier hosts sit behind a reverse proxy. Without
  // this, req.ip and the "secure" flag on cookies behave incorrectly because
  // Express doesn't trust X-Forwarded-* headers by default.
  app.set("trust proxy", 1);

  // --------------------------------------------------------------------
  // Middleware order matters — this is the sequence, and here's why:
  // --------------------------------------------------------------------

  // 1. Request ID first, so every subsequent log line (including ones from
  //    security/error middleware) can be correlated to one request.
  app.use((req, _res, next) => {
    req.requestId = randomUUID();
    next();
  });

  // 2. Structured request logging.
  app.use(
    pinoHttp({
      genReqId: (req) => req.requestId!,
      redact: ["req.headers.authorization", "req.headers.cookie"],
    })
  );

  // 3. Security headers before anything else touches the response.
  app.use(securityHeaders);

  // 4. CORS before body parsing — reject disallowed origins early and cheaply.
  app.use(corsMiddleware);

  // 5. Coarse rate limiting for the whole API surface.
  app.use(generalRateLimiter);

  // 6. Body/cookie parsing — only needed once we've decided the request is
  //    worth spending CPU on.
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // --------------------------------------------------------------------
  // Routes
  // --------------------------------------------------------------------
  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/logbook", logbookRouter);
  app.use("/api/magiclink", magiclinkRouter);
  // 404 fallback for anything unmatched.
  app.use((req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
  });

  // Error handler MUST be registered last.
  app.use(errorHandler);

  return app;
}
