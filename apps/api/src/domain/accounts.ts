import { slugify, type Role } from "@marketplace/shared";
import { Prisma } from "@prisma/client";
import { audit, notify } from "../lib/activity.js";
import { env } from "../config.js";
import { AppError } from "../lib/errors.js";
import { sendEmail, type OutboundEmail } from "../lib/mailer.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { prisma, type Db } from "../lib/prisma.js";
import { hashToken, newSecretToken, signAccessToken } from "../lib/tokens.js";
import { mergeGuestCart } from "./cart.js";
import { presentUser } from "./present.js";
import { getSettings } from "./settings.js";

const userInclude = { vendorProfile: { include: { store: true } }, customerProfile: true } satisfies Prisma.UserInclude;

export async function registerAccount(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: "CUSTOMER" | "VENDOR";
  storeName?: string;
  storeDescription?: string;
  phone?: string;
  city?: string;
  region?: string;
  country?: string;
  sessionId?: string | null;
}) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !existing.deletedAt) throw new AppError("An account with that email already exists", 409);
  const settings = await getSettings();
  const verificationToken = newSecretToken();
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        passwordHash,
        role: input.role,
        status: "ACTIVE",
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        phone: input.phone?.trim() || null,
        emailVerificationTokenHash: hashToken(verificationToken),
        customerProfile: input.role === "CUSTOMER" ? { create: {} } : undefined,
        vendorProfile: input.role === "VENDOR" ? { create: { legalName: input.storeName?.trim() || `${input.firstName} ${input.lastName}`, phone: input.phone?.trim() || null, status: "PENDING" } } : undefined,
      },
      include: userInclude,
    });
    if (input.role === "VENDOR") {
      const slug = await uniqueSlug(tx, "store", input.storeName || "store");
      await tx.vendorApplication.create({
        data: {
          userId: created.id,
          storeName: input.storeName!.trim(),
          slug,
          description: input.storeDescription!.trim(),
          contactEmail: email,
          phone: input.phone?.trim() || null,
          city: input.city?.trim() || null,
          region: input.region?.trim() || null,
          country: input.country?.trim() || "US",
          legalName: input.storeName!.trim(),
          status: "PENDING",
        },
      });
      if (!settings.vendor_approval_required) await activateVendor(tx, created.id, created.id);
    }
    const emailMessage = await notify(tx, {
      userId: created.id,
      type: "auth.registered",
      title: "Welcome to Northstar",
      body: input.role === "VENDOR" ? "Your vendor application is in." : "Your account is ready.",
      email: {
        to: email,
        subject: "Verify your Northstar email",
        text: `Welcome to Northstar. Verify your email: ${env.webOrigin}/verify-email?token=${verificationToken}`,
      },
    });
    if (input.role === "VENDOR" && settings.vendor_approval_required) {
      const admins = await tx.user.findMany({ where: { role: "ADMIN", status: "ACTIVE", deletedAt: null } });
      for (const admin of admins) {
        await notify(tx, {
          userId: admin.id,
          type: "vendor.application",
          title: "New vendor application",
          body: `${input.storeName} applied to sell on Northstar.`,
        });
      }
    }
    return { created, emailMessage };
  });
  if (user.emailMessage) await sendEmail(user.emailMessage);
  await mergeGuestCart(user.created.id, input.sessionId);
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.created.id }, include: userInclude });
  const session = await issueSession(fresh);
  return { user: presentUser(fresh), ...session };
}

export async function loginAccount(input: { email: string; password: string; sessionId?: string | null }) {
  const user = await prisma.user.findUnique({ where: { email: input.email.trim().toLowerCase() }, include: userInclude });
  if (!user || user.deletedAt || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError("Invalid email or password", 401);
  }
  if (user.status === "SUSPENDED") throw new AppError("This account is suspended", 403);
  if (user.status !== "ACTIVE") throw new AppError("This account cannot sign in", 403);
  await mergeGuestCart(user.id, input.sessionId);
  const session = await issueSession(user);
  return { user: presentUser(user), ...session };
}

export async function rotateSession(rawToken: string) {
  const found = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { user: { include: userInclude } } });
  if (!found || found.revokedAt || found.expiresAt < new Date()) throw new AppError("Session expired", 401);
  if (found.user.deletedAt || found.user.status !== "ACTIVE") throw new AppError("This account cannot sign in", 403);
  await prisma.refreshToken.update({ where: { id: found.id }, data: { revokedAt: new Date() } });
  const session = await issueSession(found.user);
  return { user: presentUser(found.user), ...session };
}

export async function revokeSession(rawToken?: string | null) {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.deletedAt || user.status !== "ACTIVE") return;
  const token = newSecretToken();
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetTokenHash: hashToken(token), passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  await sendEmail({
    to: user.email,
    subject: "Reset your Northstar password",
    text: `Reset your password: ${env.webOrigin}/reset-password?token=${token}`,
  });
}

export async function resetPassword(token: string, password: string) {
  const user = await prisma.user.findFirst({ where: { passwordResetTokenHash: hashToken(token) } });
  if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
    throw new AppError("This reset link is invalid or expired", 400);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), passwordResetTokenHash: null, passwordResetExpiresAt: null },
  });
  await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function verifyEmail(token: string) {
  const user = await prisma.user.findFirst({ where: { emailVerificationTokenHash: hashToken(token) }, include: userInclude });
  if (!user) throw new AppError("This verification link is invalid", 400);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date(), emailVerificationTokenHash: null },
    include: userInclude,
  });
  return presentUser(updated);
}

export async function resendVerification(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("Account not found", 404);
  if (user.emailVerifiedAt) return;
  const token = newSecretToken();
  await prisma.user.update({ where: { id: user.id }, data: { emailVerificationTokenHash: hashToken(token) } });
  await sendEmail({
    to: user.email,
    subject: "Verify your Northstar email",
    text: `Verify your email: ${env.webOrigin}/verify-email?token=${token}`,
  });
}

export async function updateProfile(userId: string, input: { firstName?: string; lastName?: string; phone?: string; marketingOptIn?: boolean }) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      firstName: input.firstName?.trim(),
      lastName: input.lastName?.trim(),
      phone: input.phone === undefined ? undefined : input.phone.trim() || null,
      customerProfile:
        input.marketingOptIn === undefined
          ? undefined
          : { upsert: { create: { marketingOptIn: input.marketingOptIn }, update: { marketingOptIn: input.marketingOptIn } } },
    },
    include: userInclude,
  });
  return presentUser(user);
}

export async function changePassword(userId: string, currentPassword: string, nextPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) throw new AppError("Current password is incorrect", 400);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(nextPassword) } });
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function approveVendor(applicationId: string, actorId: string) {
  const emails: OutboundEmail[] = [];
  await prisma.$transaction(async (tx) => {
    const application = await tx.vendorApplication.findUnique({ where: { id: applicationId }, include: { user: true } });
    if (!application) throw new AppError("Application not found", 404);
    await activateVendor(tx, application.userId, actorId);
    const email = await notify(tx, {
      userId: application.userId,
      type: "vendor.approved",
      title: "Store approved",
      body: `${application.storeName} can now sell on Northstar.`,
      email: { to: application.user.email, subject: "Your Northstar store is approved", text: `${application.storeName} is approved. You can publish products from the vendor dashboard.` },
    });
    if (email) emails.push(email);
    await audit(tx, { actorId, action: "vendor.approved", entity: "VendorApplication", entityId: applicationId });
  });
  for (const email of emails) await sendEmail(email);
}

export async function rejectVendor(applicationId: string, actorId: string, reason: string) {
  const application = await prisma.vendorApplication.findUnique({ where: { id: applicationId }, include: { user: { include: { vendorProfile: true } } } });
  if (!application) throw new AppError("Application not found", 404);
  await prisma.$transaction(async (tx) => {
    await tx.vendorApplication.update({ where: { id: applicationId }, data: { status: "REJECTED", rejectionReason: reason, reviewedById: actorId, reviewedAt: new Date() } });
    if (application.user.vendorProfile) {
      await tx.vendorProfile.update({ where: { id: application.user.vendorProfile.id }, data: { status: "REJECTED" } });
    }
    await notify(tx, {
      userId: application.userId,
      type: "vendor.rejected",
      title: "Application not approved",
      body: reason,
      email: { to: application.user.email, subject: "Northstar application update", text: `Your application was not approved. ${reason}` },
    });
    await audit(tx, { actorId, action: "vendor.rejected", entity: "VendorApplication", entityId: applicationId, metadata: { reason } });
  });
}

export async function setVendorSuspension(userId: string, actorId: string, suspended: boolean) {
  const profile = await prisma.vendorProfile.findUnique({ where: { userId }, include: { store: true, user: true } });
  if (!profile) throw new AppError("Vendor not found", 404);
  const status = suspended ? "SUSPENDED" : "APPROVED";
  await prisma.$transaction(async (tx) => {
    await tx.vendorProfile.update({ where: { id: profile.id }, data: { status } });
    if (profile.store) await tx.store.update({ where: { id: profile.store.id }, data: { status } });
    await notify(tx, {
      userId,
      type: suspended ? "vendor.suspended" : "vendor.approved",
      title: suspended ? "Store suspended" : "Store reactivated",
      body: suspended ? "Your store is hidden from the marketplace." : "Your store is visible again.",
    });
    await audit(tx, { actorId, action: suspended ? "vendor.suspended" : "vendor.activated", entity: "VendorProfile", entityId: profile.id });
  });
}

async function activateVendor(tx: Db, userId: string, actorId: string) {
  const application = await tx.vendorApplication.findUnique({ where: { userId } });
  const profile = await tx.vendorProfile.findUnique({ where: { userId } });
  if (!application || !profile) throw new AppError("Vendor application not found", 404);
  await tx.vendorApplication.update({
    where: { id: application.id },
    data: { status: "APPROVED", rejectionReason: null, reviewedById: actorId, reviewedAt: new Date() },
  });
  await tx.vendorProfile.update({ where: { id: profile.id }, data: { status: "APPROVED", legalName: application.legalName, phone: application.phone, taxId: application.taxId } });
  const slug = await uniqueSlug(tx, "store", application.slug, undefined);
  await tx.store.upsert({
    where: { vendorProfileId: profile.id },
    create: {
      vendorProfileId: profile.id,
      name: application.storeName,
      slug,
      description: application.description,
      contactEmail: application.contactEmail,
      phone: application.phone,
      city: application.city,
      region: application.region,
      country: application.country,
      status: "APPROVED",
      returnPolicy: application.returnPolicy,
      shippingPolicy: application.shippingPolicy,
    },
    update: { status: "APPROVED", name: application.storeName, description: application.description },
  });
}

export async function uniqueSlug(db: Db, kind: "store" | "product", source: string, ignoreId?: string) {
  const root = slugify(source).slice(0, 70) || "item";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    if (kind === "store") {
      const found = await db.store.findUnique({ where: { slug: candidate } });
      if (!found || found.id === ignoreId) return candidate;
    } else {
      const found = await db.product.findUnique({ where: { slug: candidate } });
      if (!found || found.id === ignoreId) return candidate;
    }
  }
  return `${root}-${Date.now().toString(36)}`;
}

async function issueSession(user: { id: string; role: Role | string; email: string }) {
  const refreshToken = newSecretToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  return { accessToken: signAccessToken({ id: user.id, role: user.role as Role, email: user.email }), refreshToken };
}

export async function loadActor(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: userInclude });
  if (!user) throw new AppError("Account not found", 404);
  return presentUser(user);
}
