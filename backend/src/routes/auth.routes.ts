import { Router } from "express";
import { authRateLimiter } from "../middleware/security.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/rbac.js";
import * as authController from "../controllers/auth.controller.js";

export const authRouter = Router();

// Public — deliberately rate-limited harder than the general API limiter.
authRouter.post("/register", authRateLimiter, authController.register);
authRouter.post("/login", authRateLimiter, authController.login);
authRouter.post("/refresh", authController.refresh); // reads the httpOnly cookie
authRouter.post("/logout", authenticate, authController.logout);

// Example of an RBAC-protected route: only Admins can list all users.
authRouter.get("/users", authenticate, requireRole("ADMIN"), authController.listUsers);
