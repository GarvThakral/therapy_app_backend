import type { VercelRequest, VercelResponse } from "@vercel/node";

import { applyCors, handleOptions } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { applyRateLimit } from "../../lib/rate-limit";
import { requireUser } from "../../lib/require-user";

interface CreateHomeworkBody {
  text?: string;
  sessionId?: string;
  sessionDate?: string;
  dueDate?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  if (!applyRateLimit(req, res, "homework", { limit: 200, windowMs: 60 * 1000 })) return;

  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === "GET") {
    const completedRaw = req.query.completed;
    const completed =
      completedRaw === "true" ? true : completedRaw === "false" ? false : undefined;

    try {
      const items = await prisma.homeworkItem.findMany({
        where: {
          userId: user.id,
          ...(completed === undefined ? {} : { completed }),
        },
        orderBy: [{ completed: "asc" }, { sessionDate: "desc" }, { createdAt: "desc" }],
      });

      return res.status(200).json({ homework: items });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch homework",
      });
    }
  }

  if (req.method === "POST") {
    const body = (req.body ?? {}) as CreateHomeworkBody;
    const text = body.text?.trim();
    if (!text) return res.status(400).json({ error: "Homework text is required" });

    const sessionDate = body.sessionDate ? new Date(body.sessionDate) : new Date();
    if (Number.isNaN(sessionDate.getTime())) return res.status(400).json({ error: "Invalid session date" });

    const dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.dueDate && dueDate && Number.isNaN(dueDate.getTime())) {
      return res.status(400).json({ error: "Invalid due date" });
    }

    try {
      const item = await prisma.homeworkItem.create({
        data: {
          userId: user.id,
          sessionId: body.sessionId || null,
          text,
          sessionDate,
          dueDate,
        },
      });

      return res.status(201).json({ homework: item });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to create homework",
      });
    }
  }

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
