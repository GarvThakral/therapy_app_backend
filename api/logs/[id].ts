import type { EntryType } from "@prisma/client";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { applyCors, handleOptions } from "../../lib/http";
import { serializeLogEntry } from "../../lib/logs";
import { prisma } from "../../lib/prisma";
import { applyRateLimit } from "../../lib/rate-limit";
import { requireUser } from "../../lib/require-user";

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

  const existing = await prisma.logEntry.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return res.status(404).json({ error: "Log not found" });
  }

  if (req.method === "PATCH") {
    const body = (req.body ?? {}) as UpdateLogBody;
    const data: Record<string, unknown> = {};

    if (typeof body.text === "string") data.text = body.text.trim();
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
    if (typeof body.prepNote === "string") data.prepNote = body.prepNote.trim();

    try {
      const updated = await prisma.logEntry.update({
        where: { id: existing.id },
        data,
      });

      return res.status(200).json({ log: serializeLogEntry(updated) });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to update log",
      });
    }
  }

  if (req.method === "DELETE") {
    try {
      await prisma.logEntry.delete({ where: { id: existing.id } });
      return res.status(204).end();
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to delete log",
      });
    }
  }

  res.setHeader("Allow", "PATCH, DELETE, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
