import type { VercelRequest, VercelResponse } from "@vercel/node";

import { prisma } from "../lib/prisma";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const timestamp = new Date().toISOString();

  if (!process.env.DATABASE_URL) {
    return res.status(200).json({
      ok: true,
      timestamp,
      database: "not_configured",
    });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;

    return res.status(200).json({
      ok: true,
      timestamp,
      database: "up",
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      timestamp,
      database: "down",
      error: error instanceof Error ? error.message : "Unknown database error",
    });
  }
}
