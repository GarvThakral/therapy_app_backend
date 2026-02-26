import type { VercelRequest, VercelResponse } from "@vercel/node";

const DEFAULT_ALLOWED_HEADERS = "Content-Type, Authorization";
const DEFAULT_ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

export function applyCors(req: VercelRequest, res: VercelResponse) {
  const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
  const requestOrigin = req.headers.origin;

  if (allowedOrigins.length > 0 && requestOrigin && allowedOrigins.includes(requestOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    res.setHeader("Vary", "Origin");
  } else if (allowedOrigins.length > 0 && !requestOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigins[0]);
  } else if (requestOrigin) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Headers", DEFAULT_ALLOWED_HEADERS);
  res.setHeader("Access-Control-Allow-Methods", DEFAULT_ALLOWED_METHODS);
}

export function handleOptions(req: VercelRequest, res: VercelResponse): boolean {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}
