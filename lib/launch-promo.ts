import type { Prisma } from "@prisma/client";

import { prisma } from "./prisma.js";

const DEFAULT_PROMO_LIMIT = 35;
const DEFAULT_PROMO_CAMPAIGN = "launch-early-pro-2026-04";
const LAUNCH_PROMO_LOCK_ID = 42035114;

interface CreateUserWithLaunchPromoInput {
  email: string;
  name: string | null;
  passwordHash: string;
  displayName: string;
  encryptDisplayName: (value: string) => string;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isLaunchPromoEnabled() {
  const raw = process.env.AUTO_PRO_SIGNUP_ENABLED?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "false" && raw !== "0" && raw !== "off";
}

function getLaunchPromoConfig() {
  return {
    enabled: isLaunchPromoEnabled(),
    campaign: process.env.AUTO_PRO_SIGNUP_CAMPAIGN?.trim() || DEFAULT_PROMO_CAMPAIGN,
    limit: parsePositiveInteger(process.env.AUTO_PRO_SIGNUP_LIMIT, DEFAULT_PROMO_LIMIT),
  };
}

async function resolveLaunchPlan(tx: Prisma.TransactionClient, email: string) {
  const config = getLaunchPromoConfig();
  if (!config.enabled || config.limit <= 0) {
    return { plan: "FREE" as const, grantId: null, createGrant: false };
  }

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LAUNCH_PROMO_LOCK_ID})`;

  const existingGrant = await tx.launchPromoGrant.findUnique({
    where: {
      campaign_email: {
        campaign: config.campaign,
        email,
      },
    },
  });

  if (existingGrant) {
    return {
      plan: existingGrant.grantedPlan,
      grantId: existingGrant.id,
      createGrant: false,
    };
  }

  const grantedCount = await tx.launchPromoGrant.count({
    where: {
      campaign: config.campaign,
    },
  });

  if (grantedCount >= config.limit) {
    return { plan: "FREE" as const, grantId: null, createGrant: false };
  }

  return { plan: "PRO" as const, grantId: null, createGrant: true };
}

export async function createUserWithLaunchPromo(input: CreateUserWithLaunchPromoInput) {
  return prisma.$transaction(async (tx) => {
    const promo = await resolveLaunchPlan(tx, input.email);
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        plan: promo.plan,
        proUntil: null,
        profile: {
          create: {
            displayName: input.encryptDisplayName(input.displayName),
            onboarded: false,
          },
        },
      },
    });

    if (promo.createGrant) {
      await tx.launchPromoGrant.create({
        data: {
          campaign: getLaunchPromoConfig().campaign,
          email: input.email,
          userId: user.id,
          grantedPlan: "PRO",
        },
      });
    } else if (promo.grantId) {
      await tx.launchPromoGrant.update({
        where: { id: promo.grantId },
        data: {
          userId: user.id,
        },
      });
    }

    return user;
  });
}
