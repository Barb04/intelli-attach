import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Centralized error handler — must be registered LAST, after all routes.
 * The key discipline here: in production we never leak stack traces or raw
 * driver error messages (e.g. a raw Postgres constraint-violation message
 * can reveal schema details) back to the client. In development we show
 * everything, because you need it while debugging.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const message = isAppError ? err.message : "Internal server error";

  console.error(`[${req.requestId ?? "no-request-id"}]`, err);

  res.status(statusCode).json({
    error: message,
    ...(env.NODE_ENV === "development" && err instanceof Error
      ? { stack: err.stack }
      : {}),
  });
}
