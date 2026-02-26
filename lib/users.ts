import type { User } from "@prisma/client";

import type { PublicUser } from "./plans";

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
  };
}
