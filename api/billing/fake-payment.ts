import type { VercelRequest, VercelResponse } from "@vercel/node";

import { parseBearerToken, verifyToken } from "../../lib/auth";
import { applyCors, handleOptions } from "../../lib/http";
import { isValidPlan } from "../../lib/plans";
import { prisma } from "../../lib/prisma";
import { applyRateLimit } from "../../lib/rate-limit";
import { toPublicUser } from "../../lib/users";

interface PaymentBody {
  plan?: unknown;
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

  const body = (req.body ?? {}) as PaymentBody;
  if (!isValidPlan(body.plan)) {
    return res.status(400).json({ error: "Plan must be FREE or PRO" });
  }

  try {
    const payload = verifyToken(token);
    const updated = await prisma.user.update({
      where: { id: payload.userId },
      data: { plan: body.plan },
    });

    return res.status(200).json({
      message: body.plan === "PRO" ? "Fake payment successful" : "Switched to free plan",
      user: toPublicUser(updated),
    });
  } catch (error) {
    return res.status(401).json({
      error: error instanceof Error ? error.message : "Unauthorized",
    });
  }
}
