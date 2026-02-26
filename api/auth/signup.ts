import type { VercelRequest, VercelResponse } from "@vercel/node";

import { signToken } from "../../lib/auth";
import { applyCors, handleOptions } from "../../lib/http";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { applyRateLimit } from "../../lib/rate-limit";
import { toPublicUser } from "../../lib/users";

interface SignupBody {
  email?: string;
  password?: string;
  name?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  if (!applyRateLimit(req, res, "auth-signup", { limit: 10, windowMs: 60 * 1000 })) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const body = (req.body ?? {}) as SignupBody;
  const email = body.email?.trim().toLowerCase();
  const password = body.password?.trim();
  const name = body.name?.trim() || null;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
      },
    });

    const publicUser = toPublicUser(user);
    const token = signToken(publicUser);

    return res.status(201).json({ token, user: publicUser });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to create account",
    });
  }
}
