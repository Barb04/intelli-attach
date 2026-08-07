import type { Request } from "express";
import { pool } from "../config/db.js";

type AuditEvent =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILURE"
  | "LOGOUT"
  | "TOKEN_REFRESH"
  | "PASSWORD_CHANGE"
  | "ROLE_CHANGE"
  | "ACCOUNT_LOCKED"
  | "MAGIC_LINK_ISSUED"
  | "MAGIC_LINK_CONSUMED"
  | "MAGIC_LINK_EXPIRED"
  | "LOGBOOK_SUBMITTED"
  | "LOGBOOK_APPROVED"
  | "LOGBOOK_REJECTED"
  | "GEOFENCE_VIOLATION"
  | "ATTACHMENT_GRADED"
  | "ATTACHMENT_COMMENTED";

interface AuditParams {
  eventType: AuditEvent;
  req: Request;
  actorUserId?: string | null;
  actorEmail?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Writes one row to the append-only audit_log table. This is intentionally
 * a fire-and-forget-ish helper called explicitly at each meaningful security
 * event, rather than a blanket "log every request" middleware — a wiretap on
 * every GET request is noise; a record of every login, lockout, role change,
 * and logbook approval is signal. Be deliberate about what counts as an
 * auditable event; that's the whole point of the table.
 *
 * We intentionally swallow logging failures rather than letting them break
 * the request that triggered them — an audit-log outage should degrade
 * observability, not take down login for every user.
 */
export async function recordAuditEvent({
  eventType,
  req,
  actorUserId = null,
  actorEmail = null,
  metadata = {},
}: AuditParams): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (event_type, actor_user_id, actor_email, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        eventType,
        actorUserId,
        actorEmail,
        req.ip,
        req.headers["user-agent"] ?? null,
        JSON.stringify(metadata),
      ]
    );
  } catch (err) {
    console.error("Failed to write audit log entry", { eventType, err });
  }
}
