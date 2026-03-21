import type { HomeworkItem } from "@prisma/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { decryptUserText, encryptUserText } from "../../lib/crypto.js";
import { handleServerError } from "../../lib/errors.js";
import { applyCors, handleOptions } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { applyRateLimit } from "../../lib/rate-limit.js";
import { requireUser } from "../../lib/require-user.js";
import { getUserPrivateKeyHex } from "../../lib/users.js";

interface CreateHomeworkBody {
  text?: string;
  sessionId?: string;
  sessionDate?: string;
  dueDate?: string;
}

function serializeHomeworkItem(item: HomeworkItem, userKeyHex: string) {
  return {
    ...item,
    text: decryptUserText(item.text, userKeyHex),
  };
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

      const userKeyHex = await getUserPrivateKeyHex(user.id);
      return res.status(200).json({ homework: items.map(h => serializeHomeworkItem(h, userKeyHex)) });
    } catch (error) {
      return handleServerError(
        res,
        "homework:list",
        error,
        "Unable to load homework right now. Please try again.",
      );
    }
  }

  if (req.method === "POST") {
    const body = (req.body ?? {}) as CreateHomeworkBody;
    const text = body.text?.trim();
    if (!text) return res.status(400).json({ error: "Homework text is required" });

    const userKeyHex = await getUserPrivateKeyHex(user.id);

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
          text: encryptUserText(text, userKeyHex),
          sessionDate,
          dueDate,
        },
      });

      return res.status(201).json({ homework: serializeHomeworkItem(item, userKeyHex) });
    } catch (error) {
      return handleServerError(
        res,
        "homework:create",
        error,
        "Unable to create homework right now. Please try again.",
      );
    }
  }

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
