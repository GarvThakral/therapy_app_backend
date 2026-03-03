import type { VercelRequest, VercelResponse } from "@vercel/node";

import { applyCors, handleOptions } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { applyRateLimit } from "../../lib/rate-limit.js";
import { requireUser } from "../../lib/require-user.js";

function serializeSession(session: Awaited<ReturnType<typeof prisma.therapySession.findFirst>>) {
  if (!session) return null;
  return {
    id: session.id,
    date: session.date,
    endDate: session.endDate,
    number: session.number,
    topics: session.topics,
    whatStoodOut: session.whatStoodOut,
    prepItems: session.prepItems,
    postMood: session.postMood,
    moodWord: session.moodWord,
    completed: session.completed,
    isCurrent: session.endDate === null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function getId(req: VercelRequest) {
  const value = req.query.id;
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  if (!applyRateLimit(req, res, "sessions-item", { limit: 180, windowMs: 60 * 1000 })) return;

  const user = await requireUser(req, res);
  if (!user) return;

  const id = getId(req);
  if (!id) return res.status(400).json({ error: "Session id is required" });

  const existing = await prisma.therapySession.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return res.status(404).json({ error: "Session not found" });

  if (req.method === "PATCH") {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    if (typeof body.date === "string") {
      const parsed = new Date(body.date);
      if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: "Invalid date" });
      data.date = parsed;
    }
    if (typeof body.endDate === "string") {
      const parsed = new Date(body.endDate);
      if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: "Invalid endDate" });
      data.endDate = parsed;
    }
    if (body.endDate === null) data.endDate = null;
    if (Array.isArray(body.topics)) data.topics = body.topics.filter(Boolean);
    if (Array.isArray(body.prepItems)) data.prepItems = body.prepItems.filter(Boolean);
    if (typeof body.whatStoodOut === "string") data.whatStoodOut = body.whatStoodOut.trim();
    if (typeof body.postMood === "number") data.postMood = body.postMood;
    if (typeof body.moodWord === "string") data.moodWord = body.moodWord.trim();
    if (typeof body.completed === "boolean") data.completed = body.completed;

    try {
      const updated = await prisma.therapySession.update({
        where: { id: existing.id },
        data,
      });
      return res.status(200).json({ session: serializeSession(updated) });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to update session",
      });
    }
  }

  if (req.method === "DELETE") {
    try {
      await prisma.therapySession.delete({ where: { id: existing.id } });
      return res.status(204).end();
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to delete session",
      });
    }
  }

  res.setHeader("Allow", "PATCH, DELETE, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
