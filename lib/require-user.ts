import type { VercelRequest, VercelResponse } from "@vercel/node";

import { parseBearerToken, verifyToken } from "./auth";
import { prisma } from "./prisma";

export async function requireUser(req: VercelRequest, res: VercelResponse) {
  const token = parseBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing authorization token" });
    return null;
  }

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });

    if (!user) {
      res.status(401).json({ error: "Invalid token" });
      return null;
    }

    return user;
  } catch (error) {
    res.status(401).json({
      error: error instanceof Error ? error.message : "Invalid token",
    });
    return null;
  }
}
