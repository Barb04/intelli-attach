import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/rbac.js";
import * as attachmentController from "../controllers/attachment.controller.js";

export const attachmentRouter = Router();

attachmentRouter.get(
  "/mine",
  authenticate,
  requireRole("ASSESSOR"),
  attachmentController.listMyAssignedAttachments
);

attachmentRouter.get(
  "/:id/entries",
  authenticate,
  requireRole("ASSESSOR"),
  attachmentController.getAttachmentEntriesForAssessor
);

attachmentRouter.post(
  "/:id/grade",
  authenticate,
  requireRole("ASSESSOR"),
  attachmentController.gradeAttachment
);

attachmentRouter.post(
  "/entries/:id/comment",
  authenticate,
  requireRole("ASSESSOR"),
  attachmentController.commentOnEntry
);