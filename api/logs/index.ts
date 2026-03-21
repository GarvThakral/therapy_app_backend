import type { EntryType } from "@prisma/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { encryptUserText } from "../../lib/crypto.js";
import { handleServerError } from "../../lib/errors.js";
import { handleCommunityRequest, type CommunityResource } from "../../lib/community.js";
import { applyCors, handleOptions } from "../../lib/http.js";
import { archiveOldLogs, serializeLogEntry } from "../../lib/logs.js";
import { prisma } from "../../lib/prisma.js";
import { applyRateLimit } from "../../lib/rate-limit.js";
import { requireUser } from "../../lib/require-user.js";
import { getUserPrivateKeyHex } from "../../lib/users.js";

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

function parseResource(value: unknown): "logs" | CommunityResource {
  if (value === "community") return "community";
  if (value === "community-comments") return "community-comments";
  if (value === "community-likes") return "community-likes";
  if (value === "community-reports") return "community-reports";
  return "logs";
}

const ALLOWED_TYPES: EntryType[] = ["trigger", "event", "thought", "win"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);

  if (!applyRateLimit(req, res, "logs", { limit: 120, windowMs: 60 * 1000 })) return;

  const user = await requireUser(req, res);
  if (!user) return;

  const resource = parseResource(req.query.resource);
  if (resource !== "logs") {
    return handleCommunityRequest(req, res, user, resource);
  }

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

      const userKeyHex = await getUserPrivateKeyHex(user.id);
      return res.status(200).json({ logs: logs.map(l => serializeLogEntry(l, userKeyHex)) });
    } catch (error) {
      return handleServerError(
        res,
        "logs:list",
        error,
        "Unable to load logs right now. Please try again.",
      );
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
      const userKeyHex = await getUserPrivateKeyHex(user.id);
      const prepNote = body.prepNote?.trim();
      const log = await prisma.logEntry.create({
        data: {
          userId: user.id,
          text: encryptUserText(text, userKeyHex),
          type,
          intensity,
          addedToPrep: Boolean(body.addedToPrep),
          prepNote: prepNote ? encryptUserText(prepNote, userKeyHex) : null,
          checkedOff: Boolean(body.checkedOff),
        },
      });

      return res.status(201).json({ log: serializeLogEntry(log, userKeyHex) });
    } catch (error) {
      return handleServerError(
        res,
        "logs:create",
        error,
        "Unable to save your log right now. Please try again.",
      );
    }
  }

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
