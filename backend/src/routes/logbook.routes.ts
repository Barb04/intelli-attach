import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/rbac.js";
import { requireScopedApproval } from "../middleware/scopedApproval.js";
import * as logbookController from "../controllers/logbook.controller.js";

export const logbookRouter = Router();

logbookRouter.post(
  "/",
  authenticate,
  requireRole("STUDENT"),
  logbookController.submitLogbookEntry
);

logbookRouter.get(
  "/mine",
  authenticate,
  requireRole("STUDENT"),
  logbookController.listMyLogbookEntries
);

logbookRouter.post(
  "/:id/approve",
  requireScopedApproval("id"),
  logbookController.approveLogbookEntry
);
logbookRouter.get(
  "/:id/for-approval",
  requireScopedApproval("id"),
  logbookController.getLogbookEntryForApproval
);