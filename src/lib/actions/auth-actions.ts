"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { currentUser } from "@/lib/auth/guards";
import { env } from "@/lib/env";

/**
 * The user as the sign-in response describes them.
 *
 * Taken from the response rather than read back with `currentUser()`: the
 * session cookie is only on the way *out* at this point, while `headers()`
 * still holds the incoming request, which has no session on it yet.
 */
function signedInUser(result: unknown): { id: string; email: string; role: string } | null {
  const user = (result as { user?: { id?: unknown; email?: unknown; role?: unknown } })
    ?.user;
  if (!user || typeof user.id !== "string" || typeof user.email !== "string") {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    role: typeof user.role === "string" ? user.role : "unknown",
  };
}

import { failure, parseInput, toActionError, writeAudit, type ActionResult } from "./shared";

/**
 * Where to land after signing in.
 *
 * Must be a path on this site: a value like `//evil.example` is a working
 * absolute URL in a browser, so anything that is not a single-slash relative
 * path is discarded rather than followed.
 */
const destinationSchema = z
  .string()
  .optional()
  .transform((value) =>
    value && value.startsWith("/") && !value.startsWith("//")
      ? value
      : "/dashboard",
  );

const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  next: destinationSchema,
});

/** Email and password sign-in. The cookie is set by the nextCookies plugin. */
export async function signInAction(
  input: unknown,
): Promise<ActionResult<{ next: string }>> {
  const parsed = parseInput(signInSchema, input);
  if (!parsed.ok) return parsed.result;

  let user: ReturnType<typeof signedInUser> = null;
  try {
    user = signedInUser(
      await auth.api.signInEmail({
        body: { email: parsed.data.email, password: parsed.data.password },
        headers: await headers(),
      }),
    );
  } catch {
    // Deliberately identical for a wrong password and an unknown address: the
    // difference tells an attacker which addresses are worth attacking.
    return failure("That email address and password do not match an account.");
  }

  if (!user) return failure("Signed in, but the account could not be read.");

  await writeAudit({
    actor: `user:${user.email}`,
    action: "auth.signed_in",
    entityType: "user",
    entityId: user.id,
    details: { role: user.role, method: "password" },
  });

  return { ok: true, data: { next: parsed.data.next } };
}

const demoSignInSchema = z.object({
  email: z
    .string()
    .email()
    .endsWith("@ruleforge.demo", "Only demo accounts can be used this way."),
  next: destinationSchema,
});

/**
 * One-click sign-in for the seeded demo users.
 *
 * Gated on DEMO_MODE and on the address being a `@ruleforge.demo` one, and the
 * password never leaves the server: the client sends only an email address.
 * This is a pitch convenience and has no business existing in a real
 * deployment, which is why it fails closed when DEMO_MODE is off.
 */
export async function demoSignInAction(
  input: unknown,
): Promise<ActionResult<{ next: string }>> {
  if (!env.DEMO_MODE) {
    return failure("Demo sign-in is disabled.");
  }
  if (!env.DEMO_PASSWORD) {
    return failure(
      "DEMO_PASSWORD is not set, so the demo accounts cannot be used.",
    );
  }

  const parsed = parseInput(demoSignInSchema, input);
  if (!parsed.ok) return parsed.result;

  let user: ReturnType<typeof signedInUser> = null;
  try {
    user = signedInUser(
      await auth.api.signInEmail({
        body: { email: parsed.data.email, password: env.DEMO_PASSWORD },
        headers: await headers(),
      }),
    );
  } catch {
    return failure(
      `Could not sign in as ${parsed.data.email}. Run \`npm run db:seed\` to create the demo users.`,
    );
  }

  if (!user) return failure("Signed in, but the account could not be read.");

  await writeAudit({
    actor: `user:${user.email}`,
    action: "auth.signed_in",
    entityType: "user",
    entityId: user.id,
    details: { role: user.role, method: "demo" },
  });

  return { ok: true, data: { next: parsed.data.next } };
}

/** Ends the session and returns to the login page. */
export async function signOutAction(): Promise<ActionResult> {
  try {
    const user = await currentUser();
    await auth.api.signOut({ headers: await headers() });
    if (user) {
      await writeAudit({
        actor: `user:${user.email}`,
        action: "auth.signed_out",
        entityType: "user",
        entityId: user.id,
      });
    }
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
