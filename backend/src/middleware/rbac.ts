import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "../types/express.js";

/**
 * requireRole is a middleware FACTORY, not a middleware itself — it returns
 * a middleware configured for the roles you pass in. This is what lets a
 * route declaration read like a sentence:
 *
 *   router.post("/logbook/:id/approve",
 *     authenticate,
 *     requireRole("SUPERVISOR", "ASSESSOR", "ADMIN"),
 *     approveLogbookEntry
 *   );
 *
 * Two things this deliberately does NOT do, and why:
 *
 * 1. It does not check resource ownership (e.g. "is this the student's OWN
 *    logbook entry"). Role membership and ownership are different concerns —
 *    an Assessor role check tells you nothing about which specific students
 *    that assessor is allowed to review. Ownership checks belong in the
 *    controller/service layer, close to the query that fetches the resource,
 *    where you actually have the row to compare against. Mixing the two into
 *    one middleware tends to produce middleware that silently does the wrong
 *    thing for edge cases.
 *
 * 2. It must run AFTER `authenticate`. It trusts req.user completely and
 *    does not re-verify the token — that's authenticate's job. Order matters:
 *    authenticate, then requireRole.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      // Defensive check — if this fires, requireRole was wired up without
      // authenticate running first. Treat it as a server misconfiguration,
      // not a client error.
      return res.status(500).json({ error: "requireRole used without authenticate" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Forbidden: insufficient role for this action",
      });
    }

    next();
  };
}

/**
 * A narrower helper for the common "resource belongs to the current user"
 * check, used inline in controllers rather than as route middleware — see
 * the design note above for why. Example usage inside a controller:
 *
 *   if (!isOwner(req.user, attachment.student_id)) return res.sendStatus(403);
 */
export function isOwner(user: { id: string }, resourceOwnerId: string): boolean {
  return user.id === resourceOwnerId;
}
