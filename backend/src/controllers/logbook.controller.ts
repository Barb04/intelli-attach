import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pool } from "../config/db.js";
import { AppError } from "../middleware/errorHandler.js";
import { recordAuditEvent } from "../middleware/auditLogger.js";
import { isOwner } from "../middleware/rbac.js";

const submitEntrySchema = z.object({
  attachmentId: z.string().uuid(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "entryDate must be YYYY-MM-DD"),
  narrative: z.string().min(10, "Narrative must be at least 10 characters"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  createdOffline: z.boolean().optional().default(false),
});

export async function submitLogbookEntry(req: Request, res: Response, next: NextFunction) {
  try {
    const body = submitEntrySchema.parse(req.body);

    const attachmentResult = await pool.query(
      `SELECT a.id, a.student_id, a.site_id,
              s.geofence_radius_m,
              ST_X(s.location::geometry) AS site_lng,
              ST_Y(s.location::geometry) AS site_lat
       FROM attachments a
       JOIN attachment_sites s ON s.id = a.site_id
       WHERE a.id = $1`,
      [body.attachmentId]
    );
    const attachment = attachmentResult.rows[0];

    if (!attachment) {
      throw new AppError("Attachment not found", 404);
    }

    if (!isOwner(req.user!, attachment.student_id)) {
      throw new AppError("Attachment not found", 404);
    }

    const insertResult = await pool.query(
      `INSERT INTO logbook_entries
         (attachment_id, entry_date, narrative, submitted_location,
          distance_from_site_m, within_geofence, created_offline, status)
       SELECT
         $1, $2, $3,
         ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
         ST_Distance(
           ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
           s.location
         ),
         ST_DWithin(
           ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
           s.location,
           s.geofence_radius_m
         ),
         $6,
         'SUBMITTED'
       FROM attachment_sites s
       WHERE s.id = $7
       RETURNING id, entry_date, distance_from_site_m, within_geofence, status`,
      [
        body.attachmentId,
        body.entryDate,
        body.narrative,
        body.latitude,
        body.longitude,
        body.createdOffline,
        attachment.site_id,
      ]
    );

    const entry = insertResult.rows[0];

    await recordAuditEvent({
      eventType: entry.within_geofence ? "LOGBOOK_SUBMITTED" : "GEOFENCE_VIOLATION",
      req,
      actorUserId: req.user!.id,
      actorEmail: req.user!.email,
      metadata: {
        logbookEntryId: entry.id,
        distanceMeters: entry.distance_from_site_m,
        withinGeofence: entry.within_geofence,
      },
    });

    res.status(201).json({ entry });
  } catch (err) {
    // Postgres unique_violation on (attachment_id, entry_date) — the
    // student already has an entry for this date. Surface this as a
    // clear 409 instead of letting it bubble up as an opaque 500, so the
    // frontend can distinguish "you already logged today" from "the
    // server is actually unreachable."
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      return next(new AppError("You already have a logbook entry for this date.", 409));
    }
    next(err);
  }
}

export async function listMyLogbookEntries(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT le.id, le.entry_date, le.narrative, le.status,
              le.distance_from_site_m, le.within_geofence, le.created_offline,
              le.created_at
       FROM logbook_entries le
       JOIN attachments a ON a.id = le.attachment_id
       WHERE a.student_id = $1
       ORDER BY le.entry_date DESC`,
      [req.user!.id]
    );
    res.json({ entries: result.rows });
  } catch (err) {
    next(err);
  }
}

export async function approveLogbookEntry(req: Request, res: Response, next: NextFunction) {
  try {
    const entryId = req.params.id;
    const decision = req.body.decision === "REJECTED" ? "REJECTED" : "APPROVED";
    const comment = typeof req.body.comment === "string" ? req.body.comment : null;

    const result = await pool.query(
      `UPDATE logbook_entries
       SET status = $1, review_comment = $2, reviewed_at = now()
       WHERE id = $3
       RETURNING id, status, reviewed_at`,
      [decision, comment, entryId]
    );

    if (result.rowCount === 0) {
      throw new AppError("Logbook entry not found", 404);
    }

    await recordAuditEvent({
      eventType: decision === "APPROVED" ? "LOGBOOK_APPROVED" : "LOGBOOK_REJECTED",
      req,
      actorEmail: req.supervisorScope?.supervisorEmail,
      metadata: { logbookEntryId: entryId, decision },
    });

    res.json({ entry: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function getLogbookEntryForApproval(req: Request, res: Response, next: NextFunction) {
  try {
    const entryId = req.params.id;

    const result = await pool.query(
      `SELECT le.id, le.entry_date, le.narrative, le.status,
              le.distance_from_site_m, le.within_geofence, le.created_offline,
              le.created_at
       FROM logbook_entries le
       WHERE le.id = $1`,
      [entryId]
    );

    if (result.rowCount === 0) {
      throw new AppError("Logbook entry not found", 404);
    }

    // No audit event here — viewing is implicit in the approve/reject flow
    // that follows, and recording every read would bloat the audit log
    // without adding meaningful accountability signal.
    res.json({ entry: result.rows[0] });
  } catch (err) {
    next(err);
  }
}