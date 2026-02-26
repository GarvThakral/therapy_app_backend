import type { VercelRequest, VercelResponse } from "@vercel/node";

import { applyCors, handleOptions } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { applyRateLimit } from "../../lib/rate-limit";
import { requireUser } from "../../lib/require-user";

interface CreateSessionBody {
  date?: string;
  topics?: string[];
  whatStoodOut?: string;
  prepItems?: string[];
  postMood?: number;
  moodWord?: string;
  completed?: boolean;
  homeworkItems?: Array<{
    text?: string;
    dueDate?: string;
  }>;
}

function serializeSession(session: Awaited<ReturnType<typeof prisma.therapySession.findFirst>>) {
  if (!session) return null;
  return {
    id: session.id,
    date: session.date,
    number: session.number,
    topics: session.topics,
    whatStoodOut: session.whatStoodOut,
    prepItems: session.prepItems,
    postMood: session.postMood,
    moodWord: session.moodWord,
    completed: session.completed,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  if (!applyRateLimit(req, res, "sessions", { limit: 180, windowMs: 60 * 1000 })) return;

  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === "GET") {
    const completedRaw = req.query.completed;
    const completed =
      completedRaw === "true" ? true : completedRaw === "false" ? false : undefined;

    try {
      const sessions = await prisma.therapySession.findMany({
        where: {
          userId: user.id,
          ...(completed === undefined ? {} : { completed }),
        },
        orderBy: { date: "desc" },
      });

      return res.status(200).json({ sessions: sessions.map(serializeSession) });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch sessions",
      });
    }
  }

  if (req.method === "POST") {
    const body = (req.body ?? {}) as CreateSessionBody;
    const date = body.date ? new Date(body.date) : new Date();
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ error: "Invalid session date" });
    }

    const topics = Array.isArray(body.topics) ? body.topics.filter(Boolean) : [];
    const prepItems = Array.isArray(body.prepItems) ? body.prepItems.filter(Boolean) : [];
    const whatStoodOut = body.whatStoodOut?.trim() || "";
    const postMood = typeof body.postMood === "number" ? body.postMood : 5;
    const moodWord = body.moodWord?.trim() || null;
    const completed = body.completed ?? true;

    try {
      const aggregate = await prisma.therapySession.aggregate({
        where: { userId: user.id },
        _max: { number: true },
      });
      const nextNumber = (aggregate._max.number ?? 0) + 1;

      const session = await prisma.therapySession.create({
        data: {
          userId: user.id,
          number: nextNumber,
          date,
          topics,
          whatStoodOut,
          prepItems,
          postMood,
          moodWord,
          completed,
          homework: {
            create: (body.homeworkItems ?? [])
              .filter(item => item.text?.trim())
              .map(item => ({
                userId: user.id,
                text: item.text!.trim(),
                sessionDate: date,
                dueDate: item.dueDate ? new Date(item.dueDate) : null,
              })),
          },
        },
        include: { homework: true },
      });

      return res.status(201).json({
        session: serializeSession(session),
        homeworkItems: session.homework,
      });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to create session",
      });
    }
  }

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
