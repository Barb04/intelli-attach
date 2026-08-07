import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pool } from "../config/db.js";
import { AppError } from "../middleware/errorHandler.js";
import { isOwner } from "../middleware/rbac.js";
import { recordAuditEvent } from "../middleware/auditLogger.js";

/**
 * The current student's own attachment — used to look up the real
 * attachmentId at submission time instead of relying on a hardcoded
 * value in the frontend. A student has at most one active attachment
 * per the current schema, so this returns a single object, not a list.
 */
export async function getMyAttachment(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT a.id, a.start_date, a.end_date, s.company_name
       FROM attachments a
       JOIN attachment_sites s ON s.id = a.site_id
       WHERE a.student_id = $1
       ORDER BY a.start_date DESC
       LIMIT 1`,
      [req.user!.id]
    );

    const attachment = result.rows[0];
    if (!attachment) {
      throw new AppError("No attachment record found for this student", 404);
    }

    res.json({ attachment });
  } catch (err) {
    next(err);
  }
}

/**
 * All attachments assigned to the currently logged-in assessor, with basic
 * progress info derived from start_date/end_date — lets the dashboard show
 * "Week 6 of 12" without a separate endpoint or any new schema beyond what
 * already existed.
 */
export async function listMyAssignedAttachments(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT a.id, a.start_date, a.end_date, a.final_grade, a.graded_at,
              u.full_name AS student_name, u.email AS student_email,
              s.company_name
       FROM attachments a
       JOIN users u ON u.id = a.student_id
       JOIN attachment_sites s ON s.id = a.site_id
       WHERE a.assessor_id = $1
       ORDER BY a.start_date DESC`,
      [req.user!.id]
    );
    res.json({ attachments: result.rows });
  } catch (err) {
    next(err);
  }
}

/**
 * All logbook entries for one attachment, but only if the requesting
 * assessor is actually the one assigned to it — same ownership-check
 * pattern used for students' own entries, just checked against
 * assessor_id instead of student_id.
 */
export async function getAttachmentEntriesForAssessor(req: Request, res: Response, next: NextFunction) {
  try {
    const attachmentId = req.params.id;

    const attachmentResult = await pool.query(
      `SELECT id, assessor_id, final_grade, final_comments, graded_at
       FROM attachments WHERE id = $1`,
      [attachmentId]
    );
    const attachment = attachmentResult.rows[0];

    if (!attachment) {
      throw new AppError("Attachment not found", 404);
    }

    if (!isOwner(req.user!, attachment.assessor_id)) {
      throw new AppError("Attachment not found", 404);
    }

    const entriesResult = await pool.query(
      `SELECT id, entry_date, narrative, status, distance_from_site_m,
              within_geofence, created_offline, assessor_comment, created_at
       FROM logbook_entries
       WHERE attachment_id = $1
       ORDER BY entry_date DESC`,
      [attachmentId]
    );

    res.json({
      attachment: {
        finalGrade: attachment.final_grade,
        finalComments: attachment.final_comments,
        gradedAt: attachment.graded_at,
      },
      entries: entriesResult.rows,
    });
  } catch (err) {
    next(err);
  }
}

const commentSchema = z.object({
  comment: z.string().min(1).max(2000),
});

/**
 * A lightweight per-entry comment, separate from a supervisor's
 * approve/reject decision — this is the assessor's own annotation
 * (e.g. "good detail on the safety procedure here"), not a status change.
 */
export async function commentOnEntry(req: Request, res: Response, next: NextFunction) {
  try {
    const entryId = req.params.id;
    const body = commentSchema.parse(req.body);

    // Ownership check via a join back to the attachment's assessor_id,
    // since logbook_entries itself has no assessor_id column.
    const result = await pool.query(
      `UPDATE logbook_entries le
       SET assessor_comment = $1
       FROM attachments a
       WHERE le.id = $2
         AND le.attachment_id = a.id
         AND a.assessor_id = $3
       RETURNING le.id, le.assessor_comment`,
      [body.comment, entryId, req.user!.id]
    );

    if (result.rowCount === 0) {
      throw new AppError("Logbook entry not found", 404);
    }

    res.json({ entry: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

const gradeSchema = z.object({
  finalGrade: z.string().min(1).max(50),
  finalComments: z.string().max(4000).optional(),
});

/**
 * The final, once-per-attachment grade. Deliberately does NOT check
 * whether graded_at is already set and block re-grading — an assessor
 * correcting a mistake is a legitimate case, and the audit log (below)
 * is what preserves the history, not a hard lock in the write path.
 */
export async function gradeAttachment(req: Request, res: Response, next: NextFunction) {
  try {
    const attachmentId = req.params.id;
    const body = gradeSchema.parse(req.body);

    const result = await pool.query(
      `UPDATE attachments
       SET final_grade = $1, final_comments = $2, graded_at = now()
       WHERE id = $3 AND assessor_id = $4
       RETURNING id, final_grade, final_comments, graded_at`,
      [body.finalGrade, body.finalComments ?? null, attachmentId, req.user!.id]
    );

    if (result.rowCount === 0) {
      throw new AppError("Attachment not found", 404);
    }

    await recordAuditEvent({
      eventType: "ATTACHMENT_GRADED",
      req,
      actorUserId: req.user!.id,
      actorEmail: req.user!.email,
      metadata: { attachmentId, finalGrade: body.finalGrade },
    });

    res.json({ attachment: result.rows[0] });
  } catch (err) {
    next(err);
  }
}