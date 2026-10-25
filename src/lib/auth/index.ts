import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/lib/db";
import { env } from "@/lib/env";

/** Roles recognised by RuleForge. Kept in step with `userRoleEnum` in the schema. */
export const USER_ROLES = ["officer", "head", "ops", "auditor"] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Better Auth instance. Email/password only for now; the maker/checker
 * enforcement that uses `role` lives with the approval flow, not here.
 *
 * The auth tables are generated with `npm run auth:generate` into
 * `src/db/auth-schema.ts` and re-exported from `src/db/schema.ts`.
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        // Spread: Better Auth wants a mutable array of literals here.
        type: [...USER_ROLES],
        required: false,
        defaultValue: "officer",
        // Server-owned: a signup request must not be able to pick its own role.
        input: false,
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
