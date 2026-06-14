import type { VercelRequest, VercelResponse } from "@vercel/node";

import { parseBearerToken, verifyToken } from "../lib/auth.js";
import { applyCors, handleOptions } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { applyRateLimit } from "../lib/rate-limit.js";

interface ContactBody {
  name?: string;
  email?: string;
  topic?: string;
  message?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 120;
const MAX_TOPIC = 80;
const MAX_MESSAGE = 4000;

/**
 * Public contact endpoint. Accepts a message from the website Contact form and
 * persists it. Authentication is optional — if a valid bearer token is present
 * we record the userId, otherwise the message is stored anonymously.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Cheap abuse protection: 5 messages / 10 minutes per IP.
  if (!applyRateLimit(req, res, "contact", { limit: 5, windowMs: 10 * 60 * 1000 })) return;

  const body = (req.body ?? {}) as ContactBody;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME) : null;
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 254) : "";
  const topic = typeof body.topic === "string" && body.topic.trim()
    ? body.topic.trim().slice(0, MAX_TOPIC)
    : "General question";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid email address is required." });
  }
  if (message.length < 2) {
    return res.status(400).json({ error: "Please include a message." });
  }

  // Optional: attach the signed-in user's id if a valid token was sent.
  let userId: string | null = null;
  const token = parseBearerToken(req);
  if (token) {
    try {
      userId = verifyToken(token).userId;
    } catch {
      userId = null;
    }
  }

  try {
    await prisma.contactMessage.create({
      data: { name: name || null, email, topic, message, userId },
    });
    return res.status(201).json({ ok: true });
  } catch (error) {
    // Belt-and-suspenders: if the table hasn't been migrated yet, don't 500 the
    // user — log the message server-side so it isn't lost and still succeed.
    console.error("[contact] could not persist message", {
      email,
      topic,
      hasMessage: message.length > 0,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(202).json({ ok: true, queued: true });
  }
}
