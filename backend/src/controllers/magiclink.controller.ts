import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../config/db.js";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import { recordAuditEvent } from "../middleware/auditLogger.js";


const MAGIC_LINK_TTL_MINUTES = 30;
const SUPERVISOR_SESSION_TTL = "10m";

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function generatePin(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

const issueLinkSchema = z.object({
  logbookEntryId: z.string().uuid(),
});

export async function issueMagicLink(req: Request, res: Response, next: NextFunction) {
  try {
    const body = issueLinkSchema.parse(req.body);

    const entryResult = await pool.query(
      `SELECT le.id, a.supervisor_email
       FROM logbook_entries le
       JOIN attachments a ON a.id = le.attachment_id
       WHERE le.id = $1`,
      [body.logbookEntryId]
    );
    const entry = entryResult.rows[0];

    if (!entry) {
      throw new AppError("Logbook entry not found", 404);
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const pin = generatePin();

    const tokenHash = hashToken(rawToken);
    const pinHash = await argon2.hash(pin, { type: argon2.argon2id });

    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60_000);

    await pool.query(
      `INSERT INTO magic_links
         (supervisor_email, token_hash, pin_hash, scope_type, scope_ref_id, expires_at)
       VALUES ($1, $2, $3, 'LOGBOOK_APPROVAL', $4, $5)`,
      [entry.supervisor_email, tokenHash, pinHash, entry.id, expiresAt]
    );

    await recordAuditEvent({
      eventType: "MAGIC_LINK_ISSUED",
      req,
      actorUserId: req.user?.id,
      metadata: { logbookEntryId: entry.id, supervisorEmail: entry.supervisor_email },
    });

    const approvalLink = `${env.FRONTEND_URL}/supervisor/approve?token=${rawToken}`;
    console.log("\n========== SIMULATED SUPERVISOR NOTIFICATION ==========");
    console.log(`To: ${entry.supervisor_email}`);
    console.log(`Link (channel 1 - email): ${approvalLink}`);
    console.log(`PIN  (channel 2 - SMS):    ${pin}`);
    console.log(`Expires: ${expiresAt.toISOString()}`);
    console.log("========================================================\n");

    res.status(201).json({
      message: "Approval link issued",
      supervisorEmail: entry.supervisor_email,
      expiresAt,
    });
  } catch (err) {
    next(err);
  }
}

const verifyLinkSchema = z.object({
  token: z.string().min(1),
  pin: z.string().length(6),
});

export async function verifyMagiclink(req: Request, res: Response, next: NextFunction) {
  try {
    const body = verifyLinkSchema.parse(req.body);
    const tokenHash = hashToken(body.token);

    const result = await pool.query(
      `SELECT * FROM magic_links WHERE token_hash = $1`,
      [tokenHash]
    );
    const link = result.rows[0];

    const genericFailure = () => {
      throw new AppError("This approval link is invalid or has expired", 401);
    };

    if (!link) {
      return genericFailure();
    }

    if (link.consumed_at) {
      await recordAuditEvent({
        eventType: "MAGIC_LINK_EXPIRED",
        req,
        metadata: { reason: "already_consumed", magicLinkId: link.id },
      });
      return genericFailure();
    }

    if (new Date(link.expires_at) < new Date()) {
      await recordAuditEvent({
        eventType: "MAGIC_LINK_EXPIRED",
        req,
        metadata: { reason: "ttl_expired", magicLinkId: link.id },
      });
      return genericFailure();
    }

    if (link.attempt_count >= link.max_attempts) {
      await recordAuditEvent({
        eventType: "MAGIC_LINK_EXPIRED",
        req,
        metadata: { reason: "max_attempts_exceeded", magicLinkId: link.id },
      });
      return genericFailure();
    }

    const pinValid = await argon2.verify(link.pin_hash, body.pin);

    if (!pinValid) {
      await pool.query(
        `UPDATE magic_links SET attempt_count = attempt_count + 1 WHERE id = $1`,
        [link.id]
      );
      return genericFailure();
    }

    await pool.query(`UPDATE magic_links SET consumed_at = now() WHERE id = $1`, [
      link.id,
    ]);

    const scopedToken = jwt.sign(
      {
        scopeType: link.scope_type,
        scopeRefId: link.scope_ref_id,
        supervisorEmail: link.supervisor_email,
      },
      env.JWT_ACCESS_SECRET,
      { expiresIn: SUPERVISOR_SESSION_TTL }
    );

    await recordAuditEvent({
      eventType: "MAGIC_LINK_CONSUMED",
      req,
      actorEmail: link.supervisor_email,
      metadata: { magicLinkId: link.id, scopeRefId: link.scope_ref_id },
    });

    res.json({
      scopedToken,
      scopeType: link.scope_type,
      scopeRefId: link.scope_ref_id,
      expiresIn: SUPERVISOR_SESSION_TTL,
    });
  } catch (err) {
    next(err);
  }
}