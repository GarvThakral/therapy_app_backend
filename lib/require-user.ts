import type { VercelRequest, VercelResponse } from "@vercel/node";

import { parseBearerToken, verifyToken } from "./auth.js";
import { prisma } from "./prisma.js";

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
    console.error("[auth:require-user] token verification failed", error);
    res.status(401).json({
      error: "Session expired or invalid. Please log in again.",
    });
    return null;
  }
}
