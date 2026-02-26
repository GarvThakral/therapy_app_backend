import type { VercelRequest, VercelResponse } from "@vercel/node";

interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

interface RateWindow {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateWindow>();

function getClientIp(req: VercelRequest) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const [ip] = forwarded.split(",");
    return ip.trim();
  }

  if (Array.isArray(forwarded) && forwarded[0]) {
    const [ip] = forwarded[0].split(",");
    return ip.trim();
  }

  return req.socket.remoteAddress ?? "unknown";
}

export function applyRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  keyPrefix: string,
  config: RateLimitConfig,
) {
  const now = Date.now();
  const ip = getClientIp(req);
  const key = `${keyPrefix}:${ip}`;
  const existing = store.get(key);

  if (!existing || now > existing.resetAt) {
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return true;
  }

  if (existing.count >= config.limit) {
    const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(Math.max(retryAfter, 1)));
    res.status(429).json({ error: "Too many requests. Please slow down." });
    return false;
  }

  existing.count += 1;
  store.set(key, existing);
  return true;
}
