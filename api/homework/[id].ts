import type { VercelRequest, VercelResponse } from "@vercel/node";

import { applyCors, handleOptions } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { applyRateLimit } from "../../lib/rate-limit";
import { requireUser } from "../../lib/require-user";

function getId(req: VercelRequest) {
  const value = req.query.id;
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  if (!applyRateLimit(req, res, "homework-item", { limit: 200, windowMs: 60 * 1000 })) return;

  const user = await requireUser(req, res);
  if (!user) return;

  const id = getId(req);
  if (!id) return res.status(400).json({ error: "Homework id is required" });

  const existing = await prisma.homeworkItem.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return res.status(404).json({ error: "Homework not found" });

  if (req.method === "PATCH") {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    if (typeof body.text === "string") data.text = body.text.trim();
    if (typeof body.completed === "boolean") {
      data.completed = body.completed;
      data.completedDate = body.completed ? new Date() : null;
    }
    if ("dueDate" in body) {
      if (!body.dueDate) {
        data.dueDate = null;
      } else if (typeof body.dueDate === "string") {
        const parsed = new Date(body.dueDate);
        if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: "Invalid due date" });
        data.dueDate = parsed;
      }
    }

    try {
      const updated = await prisma.homeworkItem.update({
        where: { id: existing.id },
        data,
      });
      return res.status(200).json({ homework: updated });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to update homework",
      });
    }
  }

  if (req.method === "DELETE") {
    try {
      await prisma.homeworkItem.delete({ where: { id: existing.id } });
      return res.status(204).end();
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to delete homework",
      });
    }
  }

  res.setHeader("Allow", "PATCH, DELETE, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
