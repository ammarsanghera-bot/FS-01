import { createHmac } from "node:crypto";
import { env } from "../config.js";
import { AppError } from "../lib/errors.js";
import { safeEqual } from "../lib/tokens.js";

export type IntentResult = { providerIntentId: string; clientSecret?: string };
export type ConfirmResult = { status: "SUCCEEDED" | "FAILED"; providerRef: string | null; failureReason?: string };

export interface PaymentProvider {
  name: "mock" | "stripe";
  createIntent(input: {
    amountCents: number;
    currency: string;
    orderId: string;
    orderNumber: string;
    idempotencyKey: string;
  }): Promise<IntentResult>;
  confirm(input: { providerIntentId: string | null; outcome?: "success" | "failure" }): Promise<ConfirmResult>;
  refund(input: { providerIntentId: string | null; amountCents: number; idempotencyKey: string }): Promise<{ providerRefundId: string }>;
  verifyWebhook(raw: Buffer, signature: string | undefined): boolean;
  transferToVendor(input: {
    amountCents: number;
    currency: string;
    destination: string;
    orderId: string;
    vendorOrderId: string;
  }): Promise<string | null>;
}

const mockProvider: PaymentProvider = {
  name: "mock",
  async createIntent({ idempotencyKey }) {
    return { providerIntentId: `mock_pi_${idempotencyKey}`, clientSecret: `mock_secret_${idempotencyKey}` };
  },
  async confirm({ providerIntentId, outcome }) {
    if (outcome === "failure") {
      return { status: "FAILED", providerRef: null, failureReason: "The payment was declined" };
    }
    return { status: "SUCCEEDED", providerRef: `mock_ch_${providerIntentId ?? "manual"}` };
  },
  async refund({ idempotencyKey }) {
    return { providerRefundId: `mock_re_${idempotencyKey}` };
  },
  verifyWebhook(raw, signature) {
    if (!signature) return false;
    const expected = createHmac("sha256", env.mockWebhookSecret).update(raw).digest("hex");
    return safeEqual(expected, signature);
  },
  async transferToVendor() {
    return null;
  },
};

async function stripeForm(path: string, body: URLSearchParams, idempotencyKey?: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.stripeSecretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body,
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === "object" && payload.error && "message" in payload.error ? String((payload.error as { message: string }).message) : "Stripe request failed";
    throw new AppError(message, 402);
  }
  return payload;
}

const stripeProvider: PaymentProvider = {
  name: "stripe",
  async createIntent(input) {
    const body = new URLSearchParams({
      amount: String(input.amountCents),
      currency: input.currency.toLowerCase(),
      transfer_group: input.orderId,
      "automatic_payment_methods[enabled]": "true",
      "metadata[orderId]": input.orderId,
      "metadata[orderNumber]": input.orderNumber,
    });
    const intent = await stripeForm("/payment_intents", body, input.idempotencyKey);
    return {
      providerIntentId: String(intent.id),
      clientSecret: typeof intent.client_secret === "string" ? intent.client_secret : undefined,
    };
  },
  async confirm({ providerIntentId, outcome }) {
    if (!providerIntentId) return { status: "FAILED", providerRef: null, failureReason: "Missing payment intent" };
    if (outcome === "failure") return { status: "FAILED", providerRef: providerIntentId, failureReason: "The payment was declined" };
    const response = await fetch(`https://api.stripe.com/v1/payment_intents/${providerIntentId}`, {
      headers: { authorization: `Bearer ${env.stripeSecretKey}` },
    });
    const intent = (await response.json()) as { id?: string; status?: string; last_payment_error?: { message?: string } };
    if (!response.ok || intent.status !== "succeeded") {
      return { status: "FAILED", providerRef: providerIntentId, failureReason: intent.last_payment_error?.message || "Payment was not completed" };
    }
    return { status: "SUCCEEDED", providerRef: intent.id ?? providerIntentId };
  },
  async refund(input) {
    if (!input.providerIntentId) throw new AppError("This payment has no provider reference", 409);
    const refund = await stripeForm(
      "/refunds",
      new URLSearchParams({ payment_intent: input.providerIntentId, amount: String(input.amountCents) }),
      input.idempotencyKey,
    );
    return { providerRefundId: String(refund.id) };
  },
  verifyWebhook(raw, signature) {
    if (!signature || !env.stripeWebhookSecret) return false;
    let timestamp = "";
    const signatures: string[] = [];
    for (const part of signature.split(",")) {
      const [key, value] = part.split("=");
      if (key === "t") timestamp = value ?? "";
      if (key === "v1" && value) signatures.push(value);
    }
    if (!timestamp || signatures.length === 0) return false;
    const expected = createHmac("sha256", env.stripeWebhookSecret).update(`${timestamp}.${raw.toString("utf8")}`).digest("hex");
    return signatures.some((value) => safeEqual(value, expected));
  },
  async transferToVendor(input) {
    if (input.amountCents <= 0) return null;
    const transfer = await stripeForm(
      "/transfers",
      new URLSearchParams({
        amount: String(input.amountCents),
        currency: input.currency.toLowerCase(),
        destination: input.destination,
        transfer_group: input.orderId,
        "metadata[vendorOrderId]": input.vendorOrderId,
      }),
      `transfer_${input.vendorOrderId}`,
    );
    return String(transfer.id);
  },
};

export function getPaymentProvider(): PaymentProvider {
  return env.stripeSecretKey ? stripeProvider : mockProvider;
}
