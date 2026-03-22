import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";

import { signToken } from "../../lib/auth.js";
import { encryptText } from "../../lib/crypto.js";
import { handleServerError } from "../../lib/errors.js";
import { applyCors, handleOptions } from "../../lib/http.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { prisma } from "../../lib/prisma.js";
import { applyRateLimit } from "../../lib/rate-limit.js";
import { toPublicUser } from "../../lib/users.js";

interface LoginBody {
  email?: string;
  password?: string;
}

interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type GoogleTokenResponse = {
  access_token?: string;
  id_token?: string;
};

type GoogleUserInfo = {
  email?: string;
  name?: string;
};

function queryParam(req: VercelRequest, key: string): string | null {
  const value = req.query[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function normalizeNextPath(value: string | null): string {
  if (!value) return "/app";
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/app";
  return trimmed;
}

function parseGoogleStateNext(state: string | null): string {
  if (!state) return "/app";
  try {
    const raw = Buffer.from(state, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { next?: unknown };
    return normalizeNextPath(typeof parsed.next === "string" ? parsed.next : null);
  } catch {
    return "/app";
  }
}

function getGoogleConfig(): GoogleConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.");
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
  };
}

function getFrontendBaseUrl(req: VercelRequest): string {
  const explicit = process.env.FRONTEND_URL?.trim();
  if (explicit) return explicit;
  if (req.headers.origin) return req.headers.origin;
  const firstCors = process.env.CORS_ORIGIN?.split(",").map(v => v.trim()).find(Boolean);
  return firstCors || "http://localhost:5174";
}

function buildGoogleAuthUrl(config: GoogleConfig, nextPath: string): string {
  const state = Buffer.from(
    JSON.stringify({
      nonce: randomBytes(12).toString("hex"),
      next: nextPath,
    }),
  ).toString("base64url");

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeGoogleCode(config: GoogleConfig, code: string): Promise<GoogleTokenResponse> {
  const form = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse & { error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || "Google token exchange failed.");
  }

  return payload;
}

async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as GoogleUserInfo;
  if (!response.ok) {
    throw new Error("Google userinfo request failed.");
  }

  return payload;
}

function redirectToFrontendAuth(
  req: VercelRequest,
  res: VercelResponse,
  params: Record<string, string | null | undefined>,
) {
  const redirect = new URL("/auth", getFrontendBaseUrl(req));
  for (const [key, value] of Object.entries(params)) {
    if (value && value.trim()) {
      redirect.searchParams.set(key, value);
    }
  }

  res.statusCode = 302;
  res.setHeader("Location", redirect.toString());
  return res.end();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);

  const googleProvider = queryParam(req, "provider");
  const googleIntent = queryParam(req, "intent");
  const googleCode = queryParam(req, "code");
  const isGoogleStart = req.method === "GET" && googleProvider === "google" && (googleIntent || "start") === "start";
  const isGoogleCallback = req.method === "GET" && ((googleIntent === "callback") || Boolean(googleCode));

  if (isGoogleStart || isGoogleCallback) {
    if (!applyRateLimit(req, res, "auth-google", { limit: 30, windowMs: 60 * 1000 })) return;

    if (isGoogleStart) {
      try {
        const config = getGoogleConfig();
        const nextPath = normalizeNextPath(queryParam(req, "next"));
        const url = buildGoogleAuthUrl(config, nextPath);
        return res.status(200).json({ url });
      } catch (error) {
        return handleServerError(
          res,
          "auth:google:start",
          error,
          "Unable to start Google login right now. Please try again.",
        );
      }
    }

    if (isGoogleCallback) {
      const code = queryParam(req, "code");
      const nextPath = parseGoogleStateNext(queryParam(req, "state"));

      if (!code) {
        return redirectToFrontendAuth(req, res, {
          provider: "google",
          status: "error",
          error: "Missing Google authorization code.",
          next: nextPath,
        });
      }

      try {
        const config = getGoogleConfig();
        const tokens = await exchangeGoogleCode(config, code);
        const profile = await fetchGoogleUserInfo(tokens.access_token as string);
        const email = profile.email?.trim().toLowerCase();
        const name = profile.name?.trim() || null;

        if (!email) {
          return redirectToFrontendAuth(req, res, {
            provider: "google",
            status: "error",
            error: "Google account did not return an email address.",
            next: nextPath,
          });
        }

        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          const randomPassword = randomBytes(24).toString("hex");
          const passwordHash = await hashPassword(randomPassword);
          const defaultDisplayName = name || email.split("@")[0] || "Alex";
          user = await prisma.user.create({
            data: {
              email,
              name,
              passwordHash,
              profile: {
                create: {
                  displayName: encryptText(defaultDisplayName),
                  onboarded: false,
                },
              },
            },
          });
        } else if (!user.name && name) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { name },
          });
        }

        const token = signToken(toPublicUser(user));
        return redirectToFrontendAuth(req, res, {
          provider: "google",
          status: "ok",
          token,
          next: nextPath,
        });
      } catch (error) {
        console.error("[auth:google:callback] failed", error);
        return redirectToFrontendAuth(req, res, {
          provider: "google",
          status: "error",
          error: error instanceof Error ? error.message : "Google login failed.",
          next: nextPath,
        });
      }
    }

    return res.status(400).json({ error: "Invalid Google login intent." });
  }

  if (!applyRateLimit(req, res, "auth-login", { limit: 20, windowMs: 60 * 1000 })) return;

  if (req.method === "POST") {
    const body = (req.body ?? {}) as LoginBody;
    const email = body.email?.trim().toLowerCase();
    const password = body.password?.trim();

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const isValidPassword = await verifyPassword(password, user.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const publicUser = toPublicUser(user);
      const token = signToken(publicUser);

      return res.status(200).json({ token, user: publicUser });
    } catch (error) {
      return handleServerError(
        res,
        "auth:login",
        error,
        "Unable to log in right now. Please try again.",
      );
    }
  }

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return res.status(405).json({ error: "Method Not Allowed" });
}
