import type { VercelRequest, VercelResponse } from "@vercel/node";

import { applyCors, handleOptions } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { applyRateLimit } from "../../lib/rate-limit";
import { requireUser } from "../../lib/require-user";

function serializeProfile(profile: Awaited<ReturnType<typeof prisma.userProfile.findFirst>>) {
  if (!profile) return null;
  return {
    id: profile.id,
    displayName: profile.displayName,
    therapistName: profile.therapistName,
    sessionFrequency: profile.sessionFrequency,
    sessionDay: profile.sessionDay,
    sessionTime: profile.sessionTime,
    nextSessionDate: profile.nextSessionDate,
    preSessionReminder: profile.preSessionReminder,
    postSessionReminder: profile.postSessionReminder,
    enablePreReminder: profile.enablePreReminder,
    enablePostReminder: profile.enablePostReminder,
    enableHomeworkReminder: profile.enableHomeworkReminder,
    enableWeeklyNudge: profile.enableWeeklyNudge,
    theme: profile.theme,
    fontSize: profile.fontSize,
    aiSuggestions: profile.aiSuggestions,
    onboarded: profile.onboarded,
  };
}

function toDate(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  if (!applyRateLimit(req, res, "profile", { limit: 180, windowMs: 60 * 1000 })) return;

  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === "GET") {
    try {
      let profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
      if (!profile) {
        profile = await prisma.userProfile.create({
          data: {
            userId: user.id,
            displayName: user.name || "Alex",
          },
        });
      }

      return res.status(200).json({ profile: serializeProfile(profile) });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch profile",
      });
    }
  }

  if (req.method === "PUT") {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    if (typeof body.displayName === "string") data.displayName = body.displayName.trim() || "Alex";
    if (typeof body.therapistName === "string") data.therapistName = body.therapistName.trim() || null;
    if (typeof body.sessionFrequency === "string") data.sessionFrequency = body.sessionFrequency;
    if (typeof body.sessionDay === "string") data.sessionDay = body.sessionDay;
    if (typeof body.sessionTime === "string") data.sessionTime = body.sessionTime;
    if (typeof body.preSessionReminder === "number") data.preSessionReminder = body.preSessionReminder;
    if (typeof body.postSessionReminder === "number") data.postSessionReminder = body.postSessionReminder;
    if (typeof body.enablePreReminder === "boolean") data.enablePreReminder = body.enablePreReminder;
    if (typeof body.enablePostReminder === "boolean") data.enablePostReminder = body.enablePostReminder;
    if (typeof body.enableHomeworkReminder === "boolean") data.enableHomeworkReminder = body.enableHomeworkReminder;
    if (typeof body.enableWeeklyNudge === "boolean") data.enableWeeklyNudge = body.enableWeeklyNudge;
    if (typeof body.theme === "string") data.theme = body.theme;
    if (typeof body.fontSize === "string") data.fontSize = body.fontSize;
    if (typeof body.aiSuggestions === "boolean") data.aiSuggestions = body.aiSuggestions;
    if (typeof body.onboarded === "boolean") data.onboarded = body.onboarded;
    if ("nextSessionDate" in body) data.nextSessionDate = toDate(body.nextSessionDate);

    try {
      const profile = await prisma.userProfile.upsert({
        where: { userId: user.id },
        update: data,
        create: {
          userId: user.id,
          displayName: user.name || "Alex",
          ...data,
        },
      });

      return res.status(200).json({ profile: serializeProfile(profile) });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to update profile",
      });
    }
  }

  res.setHeader("Allow", "GET, PUT, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
