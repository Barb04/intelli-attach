import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

interface ScopedTokenPayload {
  scopeType: string;
  scopeRefId: string;
  supervisorEmail: string;
}

declare global {
  namespace Express {
    interface Request {
      supervisorScope?: ScopedTokenPayload;
    }
  }
}

export function requireScopedApproval(paramName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing scoped approval token" });
    }

    const token = header.slice("Bearer ".length);

    let payload: ScopedTokenPayload;
    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as ScopedTokenPayload;
    } catch {
      return res.status(401).json({ error: "Invalid or expired approval token" });
    }

    if (!payload.scopeType || !payload.scopeRefId) {
      return res.status(401).json({ error: "Malformed approval token" });
    }

    const targetResourceId = req.params[paramName];
    if (payload.scopeRefId !== targetResourceId) {
      return res.status(403).json({
        error: "This approval token is not valid for the requested resource",
      });
    }

    req.supervisorScope = payload;
    next();
  };
}