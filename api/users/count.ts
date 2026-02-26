import type { VercelRequest, VercelResponse } from "@vercel/node";

import { prisma } from "../../lib/prisma";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const count = await prisma.user.count();
    return res.status(200).json({ count });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch user count",
    });
  }
}
