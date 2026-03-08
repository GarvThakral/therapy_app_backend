import type { VercelRequest, VercelResponse } from "@vercel/node";

import { parseBearerToken, verifyToken } from "../../lib/auth.js";
import { applyCors, handleOptions } from "../../lib/http.js";
import { isValidPlan } from "../../lib/plans.js";
import { prisma } from "../../lib/prisma.js";
import { applyRateLimit } from "../../lib/rate-limit.js";
import { toPublicUser } from "../../lib/users.js";

interface PaymentBody {
  plan?: unknown;
  action?: unknown;
  status?: unknown;
  paymentId?: unknown;
  sessionId?: unknown;
  checkoutId?: unknown;
  email?: unknown;
}

type BillingAction = "start" | "confirm" | "update";

type DodoConfig = {
  apiKey: string | null;
  productId: string | null;
  baseUrl: string;
};

const DODO_TEST_BASE_URL = "https://test.dodopayments.com";
const DODO_LIVE_BASE_URL = "https://live.dodopayments.com";

function parseAction(value: unknown): BillingAction {
  if (value === "start" || value === "confirm" || value === "update") return value;
  return "update";
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getDodoConfig(): DodoConfig {
  const apiKey = asString(process.env.DODO_PAYMENTS_API_KEY ?? null);
  const productId = asString(process.env.DODO_PRODUCT_ID ?? null);
  const envMode = process.env.DODO_ENVIRONMENT?.trim() === "live_mode" ? "live_mode" : "test_mode";
  return {
    apiKey,
    productId,
    baseUrl: envMode === "live_mode" ? DODO_LIVE_BASE_URL : DODO_TEST_BASE_URL,
  };
}

function buildCheckoutUrl(baseLink: string, options: {
  redirectUrl: string;
  email?: string;
  fullName?: string | null;
  userId: string;
}) {
  const url = new URL(baseLink);
  url.searchParams.set("quantity", "1");
  url.searchParams.set("redirect_url", options.redirectUrl);
  if (options.email) url.searchParams.set("email", options.email);
  if (options.fullName) url.searchParams.set("fullName", options.fullName);
  url.searchParams.set("metadata_userId", options.userId);
  return url.toString();
}

async function dodoRequest<T = unknown>(config: DodoConfig, path: string, init?: RequestInit): Promise<T> {
  if (!config.apiKey) {
    throw new Error("DODO_PAYMENTS_API_KEY is missing.");
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = asRecord(payload);
    const message = asString(details?.message) || asString(details?.error) || "Dodo API request failed.";
    throw new Error(message);
  }

  return payload as T;
}

async function createCheckoutSession(config: DodoConfig, input: {
  email: string;
  name: string | null;
  returnUrl: string;
}) {
  if (!config.productId) {
    throw new Error("DODO_PRODUCT_ID is missing.");
  }

  const body: Record<string, unknown> = {
    product_cart: [{ product_id: config.productId, quantity: 1 }],
    customer: {
      email: input.email,
      ...(input.name ? { name: input.name } : {}),
    },
    return_url: input.returnUrl,
  };

  const data = await dodoRequest<Record<string, unknown>>(config, "/checkouts", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const checkoutUrl = asString(data.checkout_url);
  if (!checkoutUrl) {
    throw new Error("Dodo checkout_url missing in response.");
  }

  return checkoutUrl;
}

async function verifyProPayment(config: DodoConfig, input: {
  status: string | null;
  paymentId: string | null;
  sessionId: string | null;
  email: string | null;
  userEmail: string;
}) {
  let resolvedStatus = input.status;
  let resolvedPaymentId = input.paymentId;
  let resolvedEmail = input.email;

  if (input.sessionId && config.apiKey) {
    const checkout = await dodoRequest<Record<string, unknown>>(config, `/checkouts/${encodeURIComponent(input.sessionId)}`);
    const checkoutCustomer = asRecord(checkout.customer);
    resolvedStatus = asString(checkout.payment_status) ?? asString(checkout.status) ?? resolvedStatus;
    resolvedPaymentId = asString(checkout.payment_id) ?? resolvedPaymentId;
    resolvedEmail =
      asString(checkoutCustomer?.email) ??
      asString(checkout.customer_email) ??
      asString(checkout.email) ??
      resolvedEmail;
  }

  if (resolvedPaymentId && config.apiKey) {
    const payment = await dodoRequest<Record<string, unknown>>(config, `/payments/${encodeURIComponent(resolvedPaymentId)}`);
    const paymentCustomer = asRecord(payment.customer);
    resolvedStatus = asString(payment.status) ?? asString(payment.payment_status) ?? resolvedStatus;
    resolvedEmail =
      asString(paymentCustomer?.email) ??
      asString(payment.customer_email) ??
      asString(payment.email) ??
      resolvedEmail;
  }

  if (resolvedStatus !== "succeeded") {
    throw new Error("Payment is not in succeeded state.");
  }

  if (resolvedEmail && resolvedEmail.toLowerCase() !== input.userEmail.toLowerCase()) {
    throw new Error("Payment email does not match logged-in user.");
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  if (!applyRateLimit(req, res, "billing-fake-payment", { limit: 30, windowMs: 60 * 1000 })) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const token = parseBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing authorization token" });
  }

  let userId: string;
  try {
    userId = verifyToken(token).userId;
  } catch (error) {
    console.error("[billing:fake-payment] token validation failed", error);
    return res.status(401).json({
      error: "Session expired or invalid. Please log in again.",
    });
  }

  const body = (req.body ?? {}) as PaymentBody;
  if (!isValidPlan(body.plan)) {
    return res.status(400).json({ error: "Plan must be FREE or PRO" });
  }
  const action = parseAction(body.action);
  const dodo = getDodoConfig();

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    if (body.plan === "PRO" && action === "start") {
      const defaultRedirect = req.headers.origin ? `${req.headers.origin}/app/settings` : null;
      const redirectUrl = process.env.DODO_PAYMENT_REDIRECT_URL?.trim() || defaultRedirect;
      if (!redirectUrl) {
        return res.status(500).json({
          error: "Missing payment redirect URL. Set DODO_PAYMENT_REDIRECT_URL in backend env.",
        });
      }

      const baseLink = process.env.DODO_PAYMENT_LINK?.trim();
      if (dodo.apiKey && dodo.productId) {
        try {
          const checkoutUrl = await createCheckoutSession(dodo, {
            email: user.email,
            name: user.name,
            returnUrl: redirectUrl,
          });
          return res.status(200).json({
            message: "Checkout session created",
            checkoutUrl,
          });
        } catch (error) {
          console.warn("[billing:fake-payment] checkout session failed, falling back to static link", error);
          if (!baseLink) {
            throw error;
          }
        }
      }

      if (baseLink) {
        const checkoutUrl = buildCheckoutUrl(baseLink, {
          redirectUrl,
          email: user.email,
          fullName: user.name,
          userId: user.id,
        });

        return res.status(200).json({
          message: "Checkout session created",
          checkoutUrl,
        });
      }

      return res.status(500).json({
        error: "Missing Dodo payment configuration. Set DODO_PAYMENTS_API_KEY + DODO_PRODUCT_ID (recommended) or DODO_PAYMENT_LINK.",
      });
    }

    if (body.plan === "PRO" && action === "confirm") {
      await verifyProPayment(dodo, {
        status: asString(body.status),
        paymentId: asString(body.paymentId),
        sessionId: asString(body.sessionId) ?? asString(body.checkoutId),
        email: asString(body.email),
        userEmail: user.email,
      });

      const upgraded = await prisma.user.update({
        where: { id: user.id },
        data: { plan: "PRO" },
      });
      return res.status(200).json({
        message: "Payment confirmed. Plan upgraded to Pro.",
        user: toPublicUser(upgraded),
      });
    }

    if (body.plan === "PRO" && action === "update") {
      return res.status(400).json({
        error: "Direct Pro updates are disabled. Start checkout and confirm payment first.",
      });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { plan: body.plan },
    });
    return res.status(200).json({
      message: body.plan === "PRO" ? "Plan upgraded to Pro." : "Switched to Free plan.",
      user: toPublicUser(updated),
    });
  } catch (error) {
    console.error("[billing:fake-payment] request failed", error);
    const message = error instanceof Error && error.message ? error.message : "Unable to process payment request.";
    return res.status(500).json({
      error: message,
    });
  }
}
