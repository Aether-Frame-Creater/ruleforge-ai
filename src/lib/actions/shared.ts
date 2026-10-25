/**
 * Shared plumbing for server actions.
 *
 * Every write in the application goes through an action built on these: the
 * role is checked on the server, the input is parsed with Zod, and an
 * `audit_log` entry is written. None of those three steps is optional.
 */
import "server-only";

import type { z } from "zod";

import { auditLog } from "@/db/schema";
import { db } from "@/lib/db";
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/guards";

/** What every action returns. Actions report failure, they do not throw at UI. */
export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function failure(
  error: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/**
 * Turns whatever went wrong into a message a person can act on.
 *
 * Access failures and validation failures are the user's business; anything
 * else is logged server-side and reported without its internals, which may
 * name tables, models or keys.
 */
export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof ForbiddenError || error instanceof UnauthenticatedError) {
    return failure(error.message);
  }
  console.error("[action]", error);
  return failure(
    error instanceof Error && error.name === "ZodError"
      ? "That input was not valid."
      : "Something went wrong completing that action. The details are in the server log.",
  );
}

/** Parses input, returning a typed failure the form can render. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
):
  | { ok: true; data: z.infer<S> }
  | { ok: false; result: ActionResult<never> } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".") || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }

  return {
    ok: false,
    result: failure("Please correct the highlighted fields.", fieldErrors),
  };
}

/** Writes one append-only audit entry. */
export async function writeAudit(entry: {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: unknown;
}): Promise<void> {
  await db.insert(auditLog).values({
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    details: (entry.details ?? null) as never,
  });
}
