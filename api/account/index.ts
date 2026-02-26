import type { VercelRequest, VercelResponse } from "@vercel/node";

import { applyCors, handleOptions } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { applyRateLimit } from "../../lib/rate-limit";
import { requireUser } from "../../lib/require-user";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  if (!applyRateLimit(req, res, "account", { limit: 30, windowMs: 60 * 1000 })) return;

  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === "DELETE") {
    try {
      await prisma.user.delete({ where: { id: user.id } });
      return res.status(204).end();
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to delete account",
      });
    }
  }

  res.setHeader("Allow", "DELETE, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
