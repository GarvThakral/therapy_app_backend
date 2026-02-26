export type Plan = "FREE" | "PRO";

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  plan: Plan;
}

export function isValidPlan(plan: unknown): plan is Plan {
  return plan === "FREE" || plan === "PRO";
}
