import type { EntryType } from "@prisma/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { applyCors, handleOptions } from "../../lib/http";
import { archiveOldLogs, serializeLogEntry } from "../../lib/logs";
import { prisma } from "../../lib/prisma";
import { applyRateLimit } from "../../lib/rate-limit";
import { requireUser } from "../../lib/require-user";

interface CreateLogBody {
  text?: string;
  type?: EntryType;
  intensity?: number;
  addedToPrep?: boolean;
  prepNote?: string;
  checkedOff?: boolean;
}

function parseView(view: unknown): "active" | "archive" | "all" {
  if (view === "archive") return "archive";
  if (view === "all") return "all";
  return "active";
}

const ALLOWED_TYPES: EntryType[] = ["trigger", "event", "thought", "win"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);

  if (!applyRateLimit(req, res, "logs", { limit: 120, windowMs: 60 * 1000 })) return;

  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === "GET") {
    const view = parseView(req.query.view);

    try {
      await archiveOldLogs(user.id);

      const where =
        view === "active"
          ? { userId: user.id, isArchived: false }
          : view === "archive"
            ? { userId: user.id, isArchived: true }
            : { userId: user.id };

      const logs = await prisma.logEntry.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });

      return res.status(200).json({ logs: logs.map(serializeLogEntry) });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch logs",
      });
    }
  }

  if (req.method === "POST") {
    const body = (req.body ?? {}) as CreateLogBody;
    const text = body.text?.trim();
    const type = body.type;
    const intensity = Number(body.intensity);

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    if (!type || !ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ error: "Invalid log type" });
    }

    if (Number.isNaN(intensity) || intensity < 1 || intensity > 5) {
      return res.status(400).json({ error: "Intensity must be between 1 and 5" });
    }

    try {
      const log = await prisma.logEntry.create({
        data: {
          userId: user.id,
          text,
          type,
          intensity,
          addedToPrep: Boolean(body.addedToPrep),
          prepNote: body.prepNote?.trim() || null,
          checkedOff: Boolean(body.checkedOff),
        },
      });

      return res.status(201).json({ log: serializeLogEntry(log) });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to create log",
      });
    }
  }

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
