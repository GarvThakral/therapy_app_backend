import type { VercelRequest, VercelResponse } from "@vercel/node";

import { parseBearerToken, verifyToken } from "../../lib/auth";
import { applyCors, handleOptions } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { applyRateLimit } from "../../lib/rate-limit";
import { toPublicUser } from "../../lib/users";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  if (!applyRateLimit(req, res, "auth-me", { limit: 120, windowMs: 60 * 1000 })) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const token = parseBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing authorization token" });
  }

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });

    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    return res.status(200).json({ user: toPublicUser(user) });
  } catch (error) {
    return res.status(401).json({
      error: error instanceof Error ? error.message : "Invalid token",
    });
  }
}
