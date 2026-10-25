import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Better Auth instance. Email/password only for now — maker/checker roles,
 * organisations and SSO come later, once the schema exists.
 *
 * Generate the auth tables with:
 *   npx @better-auth/cli@latest generate --output src/db/auth-schema.ts
 * then re-export them from `src/db/schema.ts` and run `npm run db:push`.
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
  },
});

export type Session = typeof auth.$Infer.Session;
