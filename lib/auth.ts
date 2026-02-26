import jwt from "jsonwebtoken";
import type { VercelRequest } from "@vercel/node";

import type { PublicUser } from "./plans";

const TOKEN_TTL = "7d";

interface JwtPayload {
  userId: string;
  email: string;
}

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return secret;
}

export function signToken(user: PublicUser): string {
  const payload: JwtPayload = { userId: user.id, email: user.email };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: TOKEN_TTL });
}

export function parseBearerToken(req: VercelRequest): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getJwtSecret()) as JwtPayload;
}
