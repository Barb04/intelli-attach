import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import * as magiclinkController from "../controllers/magiclink.controller.js";

export const magiclinkRouter = Router();

magiclinkRouter.post("/issue", authenticate, magiclinkController.issueMagicLink);
magiclinkRouter.post("/verify", magiclinkController.verifyMagiclink);