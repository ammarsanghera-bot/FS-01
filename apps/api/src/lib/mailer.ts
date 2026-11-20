import nodemailer from "nodemailer";
import { env } from "../config.js";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

export type OutboundEmail = { to: string; subject: string; text: string };

export async function sendEmail(message: OutboundEmail): Promise<void> {
  if (!env.isProduction) {
    await prisma.devEmail.create({ data: message });
  }
  if (!env.smtp.host) {
    logger.info({ to: message.to, subject: message.subject }, "email stored");
    return;
  }
  const transport = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  await transport.sendMail({
    from: env.smtp.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}

export async function sendEmails(messages: OutboundEmail[]): Promise<void> {
  for (const message of messages) {
    try {
      await sendEmail(message);
    } catch (error) {
      logger.error({ err: error, to: message.to }, "email failed");
    }
  }
}
