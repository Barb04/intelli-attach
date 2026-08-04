import "express";

export type UserRole = "STUDENT" | "ASSESSOR" | "SUPERVISOR" | "ADMIN";

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  email: string;
}

// Augment Express's Request type so `req.user` is typed everywhere without
// casting. This is what lets RBAC middleware and controllers share one
// source of truth for "who is making this request".
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId?: string;
    }
  }
}
