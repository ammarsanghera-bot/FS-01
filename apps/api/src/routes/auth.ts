import { loginSchema, passwordSchema, registerSchema } from "@marketplace/shared";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import {
  changePassword,
  loadActor,
  loginAccount,
  registerAccount,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  revokeSession,
  rotateSession,
  updateProfile,
  verifyEmail,
} from "../domain/accounts.js";
import { actor, asyncHandler, ok } from "../lib/http.js";
import { requireUser } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";

export const authRouter = Router();
const COOKIE = "refresh_token";

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/api/v1/auth",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

authRouter.post("/register", authLimiter, asyncHandler(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const result = await registerAccount({ ...input, sessionId: res.locals.sessionId as string | null });
  res.cookie(COOKIE, result.refreshToken, cookieOptions());
  ok(res, { accessToken: result.accessToken, user: result.user }, "Account created", {});
}));

authRouter.post("/login", authLimiter, asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const result = await loginAccount({ ...input, sessionId: res.locals.sessionId as string | null });
  res.cookie(COOKIE, result.refreshToken, cookieOptions());
  ok(res, { accessToken: result.accessToken, user: result.user }, "Signed in");
}));

authRouter.post("/refresh", asyncHandler(async (req, res) => {
  const token = req.cookies?.[COOKIE] as string | undefined;
  if (!token) return res.status(401).json({ success: false, message: "Session expired", errors: [] });
  const result = await rotateSession(token);
  res.cookie(COOKIE, result.refreshToken, cookieOptions());
  ok(res, { accessToken: result.accessToken, user: result.user }, "Session refreshed");
}));

authRouter.post("/logout", asyncHandler(async (req, res) => {
  await revokeSession(req.cookies?.[COOKIE] as string | undefined);
  res.clearCookie(COOKIE, { path: "/api/v1/auth" });
  ok(res, { loggedOut: true }, "Signed out");
}));

authRouter.post("/forgot-password", authLimiter, asyncHandler(async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  await requestPasswordReset(email);
  ok(res, { sent: true }, "If that account exists, a reset link is on its way");
}));

authRouter.post("/reset-password", authLimiter, asyncHandler(async (req, res) => {
  const input = z.object({ token: z.string().min(10), password: passwordSchema }).parse(req.body);
  await resetPassword(input.token, input.password);
  ok(res, { reset: true }, "Password updated");
}));

authRouter.post("/verify-email", asyncHandler(async (req, res) => {
  const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
  ok(res, await verifyEmail(token), "Email verified");
}));

authRouter.post("/resend-verification", requireUser(), asyncHandler(async (_req, res) => {
  await resendVerification(actor(res).id);
  ok(res, { sent: true }, "Verification email sent");
}));

authRouter.get("/me", requireUser(), asyncHandler(async (_req, res) => {
  ok(res, await loadActor(actor(res).id));
}));

authRouter.patch("/me", requireUser(), asyncHandler(async (req, res) => {
  const input = z.object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    phone: z.string().trim().max(40).optional(),
    marketingOptIn: z.boolean().optional(),
  }).parse(req.body);
  ok(res, await updateProfile(actor(res).id, input), "Profile updated");
}));

authRouter.post("/change-password", requireUser(), asyncHandler(async (req, res) => {
  const input = z.object({ currentPassword: z.string().min(1), nextPassword: passwordSchema }).parse(req.body);
  await changePassword(actor(res).id, input.currentPassword, input.nextPassword);
  res.clearCookie(COOKIE, { path: "/api/v1/auth" });
  ok(res, { changed: true }, "Password changed. Sign in again.");
}));
