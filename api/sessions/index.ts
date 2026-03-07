import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  decryptNullableText,
  decryptStringArray,
  decryptText,
  encryptStringArray,
  encryptText,
} from "../../lib/crypto.js";
import { handleServerError } from "../../lib/errors.js";
import { applyCors, handleOptions } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { applyRateLimit } from "../../lib/rate-limit.js";
import { requireUser } from "../../lib/require-user.js";

interface CreateSessionBody {
  action?: "start" | "save";
  sessionId?: string;
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
    endDate: session.endDate,
    number: session.number,
    topics: decryptStringArray(session.topics),
    whatStoodOut: decryptText(session.whatStoodOut),
    prepItems: decryptStringArray(session.prepItems),
    postMood: session.postMood,
    moodWord: decryptNullableText(session.moodWord),
    completed: session.completed,
    isCurrent: session.endDate === null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function serializeHomeworkItem(item: Awaited<ReturnType<typeof prisma.homeworkItem.findFirst>>) {
  if (!item) return null;
  return {
    ...item,
    text: decryptText(item.text),
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
      return handleServerError(
        res,
        "sessions:list",
        error,
        "Unable to load sessions right now. Please try again.",
      );
    }
  }

  if (req.method === "POST") {
    const body = (req.body ?? {}) as CreateSessionBody;
    const date = body.date ? new Date(body.date) : new Date();
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ error: "Invalid session date" });
    }

    const action = body.action ?? "save";
    const topics = Array.isArray(body.topics)
      ? body.topics.map(value => String(value).trim()).filter(Boolean)
      : [];
    const prepItems = Array.isArray(body.prepItems)
      ? body.prepItems.map(value => String(value).trim()).filter(Boolean)
      : [];
    const whatStoodOut = body.whatStoodOut?.trim() || "";
    const postMood = typeof body.postMood === "number" ? body.postMood : 5;
    const moodWord = body.moodWord?.trim() || null;
    const completed = body.completed ?? true;

    if (action === "start") {
      try {
        const session = await prisma.$transaction(async tx => {
          await tx.therapySession.updateMany({
            where: {
              userId: user.id,
              endDate: null,
              date: { lt: date },
            },
            data: {
              endDate: date,
              completed: true,
            },
          });

          const aggregate = await tx.therapySession.aggregate({
            where: { userId: user.id },
            _max: { number: true },
          });
          const nextNumber = (aggregate._max.number ?? 0) + 1;

          return tx.therapySession.create({
            data: {
              userId: user.id,
              number: nextNumber,
              date,
              endDate: null,
              topics: [],
              whatStoodOut: encryptText(""),
              prepItems: [],
              postMood: 5,
              moodWord: null,
              completed: false,
            },
          });
        });

        return res.status(201).json({
          session: serializeSession(session),
          homeworkItems: [],
          started: true,
        });
      } catch (error) {
        return handleServerError(
          res,
          "sessions:start",
          error,
          "Unable to start a new session right now. Please try again.",
        );
      }
    }

    try {
      if (body.sessionId) {
        const existing = await prisma.therapySession.findFirst({
          where: { id: body.sessionId, userId: user.id },
        });
        if (!existing) return res.status(404).json({ error: "Session not found" });

        const updatedSession = await prisma.therapySession.update({
          where: { id: existing.id },
          data: {
            topics: encryptStringArray(topics),
            whatStoodOut: encryptText(whatStoodOut),
            prepItems: encryptStringArray(prepItems),
            postMood,
            moodWord: moodWord ? encryptText(moodWord) : null,
            completed,
          },
        });

        const createdHomework = await prisma.$transaction(
          (body.homeworkItems ?? [])
            .filter(item => item.text?.trim())
            .map(item =>
              prisma.homeworkItem.create({
                data: {
                  userId: user.id,
                  sessionId: existing.id,
                  text: encryptText(item.text!.trim()),
                  sessionDate: existing.date,
                  dueDate: item.dueDate ? new Date(item.dueDate) : null,
                },
              }),
            ),
        );

        return res.status(200).json({
          session: serializeSession(updatedSession),
          homeworkItems: createdHomework.map(serializeHomeworkItem),
        });
      }

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
          endDate: null,
          topics: encryptStringArray(topics),
          whatStoodOut: encryptText(whatStoodOut),
          prepItems: encryptStringArray(prepItems),
          postMood,
          moodWord: moodWord ? encryptText(moodWord) : null,
          completed,
          homework: {
            create: (body.homeworkItems ?? [])
              .filter(item => item.text?.trim())
              .map(item => ({
                userId: user.id,
                text: encryptText(item.text!.trim()),
                sessionDate: date,
                dueDate: item.dueDate ? new Date(item.dueDate) : null,
              })),
          },
        },
        include: { homework: true },
      });

      return res.status(201).json({
        session: serializeSession(session),
        homeworkItems: session.homework.map(serializeHomeworkItem),
      });
    } catch (error) {
      return handleServerError(
        res,
        "sessions:create",
        error,
        "Unable to save this session right now. Please try again.",
      );
    }
  }

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
