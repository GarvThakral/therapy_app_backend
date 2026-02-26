import type { VercelRequest, VercelResponse } from "@vercel/node";

import { signToken } from "../../lib/auth";
import { applyCors, handleOptions } from "../../lib/http";
import { verifyPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { applyRateLimit } from "../../lib/rate-limit";
import { toPublicUser } from "../../lib/users";

interface LoginBody {
  email?: string;
  password?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  if (!applyRateLimit(req, res, "auth-login", { limit: 20, windowMs: 60 * 1000 })) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const body = (req.body ?? {}) as LoginBody;
  const email = body.email?.trim().toLowerCase();
  const password = body.password?.trim();

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isValidPassword = await verifyPassword(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const publicUser = toPublicUser(user);
    const token = signToken(publicUser);

    return res.status(200).json({ token, user: publicUser });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to log in",
    });
  }
}
