import type { EntryType } from "@prisma/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { encryptUserText } from "../../lib/crypto.js";
import { handleServerError } from "../../lib/errors.js";
import { applyCors, handleOptions } from "../../lib/http.js";
import { serializeLogEntry } from "../../lib/logs.js";
import { prisma } from "../../lib/prisma.js";
import { applyRateLimit } from "../../lib/rate-limit.js";
import { requireUser } from "../../lib/require-user.js";
import { getUserPrivateKeyHex } from "../../lib/users.js";

interface UpdateLogBody {
  text?: string;
  type?: EntryType;
  intensity?: number;
  addedToPrep?: boolean;
  prepNote?: string | null;
  checkedOff?: boolean;
}

const ALLOWED_TYPES: EntryType[] = ["trigger", "event", "thought", "win"];

function getId(req: VercelRequest) {
  const value = req.query.id;
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);

  if (!applyRateLimit(req, res, "logs-item", { limit: 120, windowMs: 60 * 1000 })) return;

  const user = await requireUser(req, res);
  if (!user) return;

  const id = getId(req);
  if (!id) {
    return res.status(400).json({ error: "Log id is required" });
  }

  let existing;
  try {
    existing = await prisma.logEntry.findFirst({
      where: { id, userId: user.id },
    });
  } catch (error) {
    return handleServerError(
      res,
      "logs:item:find",
      error,
      "Unable to load this log right now. Please try again.",
    );
  }

  if (!existing) {
    return res.status(404).json({ error: "Log not found" });
  }

  if (req.method === "PATCH") {
    const userKeyHex = await getUserPrivateKeyHex(user.id);
    const body = (req.body ?? {}) as UpdateLogBody;
    const data: Record<string, unknown> = {};

    if (typeof body.text === "string") {
      const text = body.text.trim();
      if (!text) return res.status(400).json({ error: "Text is required" });
      data.text = encryptUserText(text, userKeyHex);
    }
    if (body.type) {
      if (!ALLOWED_TYPES.includes(body.type)) {
        return res.status(400).json({ error: "Invalid log type" });
      }
      data.type = body.type;
    }
    if (typeof body.intensity === "number") {
      if (body.intensity < 1 || body.intensity > 5) {
        return res.status(400).json({ error: "Intensity must be between 1 and 5" });
      }
      data.intensity = body.intensity;
    }
    if (typeof body.addedToPrep === "boolean") data.addedToPrep = body.addedToPrep;
    if (typeof body.checkedOff === "boolean") data.checkedOff = body.checkedOff;
    if (body.prepNote === null) data.prepNote = null;
    if (typeof body.prepNote === "string") {
      const prepNote = body.prepNote.trim();
      data.prepNote = prepNote ? encryptUserText(prepNote, userKeyHex) : null;
    }

    try {
      const updated = await prisma.logEntry.update({
        where: { id: existing.id },
        data,
      });

      return res.status(200).json({ log: serializeLogEntry(updated, userKeyHex) });
    } catch (error) {
      return handleServerError(
        res,
        "logs:item:update",
        error,
        "Unable to update this log right now. Please try again.",
      );
    }
  }

  if (req.method === "DELETE") {
    try {
      await prisma.logEntry.delete({ where: { id: existing.id } });
      return res.status(204).end();
    } catch (error) {
      return handleServerError(
        res,
        "logs:item:delete",
        error,
        "Unable to delete this log right now. Please try again.",
      );
    }
  }

  res.setHeader("Allow", "PATCH, DELETE, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
