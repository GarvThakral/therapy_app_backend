import type { User } from "@prisma/client";

import type { PublicUser } from "./plans.js";
import { generateUserPrivateKey, encryptText, decryptText } from "./crypto.js";
import { prisma } from "./prisma.js";

export async function getUserPrivateKeyHex(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { privateKey: true },
  });

  if (user?.privateKey) {
    try {
      return decryptText(user.privateKey);
    } catch {
      // If decryption fails, the key might be corrupted, fallback to generating a new one
    }
  }

  // Generate a new 32-byte private key, encrypt it using the APP_SECRET (encryptText), and save to DB
  const rawHex = generateUserPrivateKey();
  const encryptedKey = encryptText(rawHex);

  await prisma.user.update({
    where: { id: userId },
    data: { privateKey: encryptedKey },
  });

  return rawHex;
}

export function toPublicUser(user: User): PublicUser {
  let effectivePlan = user.plan;
  if (effectivePlan === "PRO" && user.proUntil && user.proUntil.getTime() < Date.now()) {
    effectivePlan = "FREE";
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: effectivePlan,
  };
}
