/**
 * Server-side access control.
 *
 * Every server action and every page that shows anything role-dependent goes
 * through here. Hiding a button is a courtesy to the user; it is not access
 * control, because the action behind it is still reachable by anyone who can
 * post to it. These functions are the actual gate.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth, type UserRole } from "@/lib/auth";

export interface SignedInUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

/** Raised when a signed-in user lacks the role an action requires. */
export class ForbiddenError extends Error {
  constructor(
    readonly required: readonly UserRole[],
    readonly actual: UserRole,
  ) {
    super(
      `This action is restricted to ${required.join(" or ")}. You are signed in as ${actual}.`,
    );
    this.name = "ForbiddenError";
  }
}

/** Raised when there is no session at all. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("You must be signed in to do this.");
    this.name = "UnauthenticatedError";
  }
}

/** The signed-in user, or null. Never throws or redirects. */
export async function currentUser(): Promise<SignedInUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const { id, name, email } = session.user;
  // `role` is nullable in the database and defaults in the JS layer only, so a
  // user without one is treated as the least privileged role, never the most.
  const role = (session.user as { role?: string | null }).role;

  return {
    id,
    name,
    email,
    role: isRole(role) ? role : "auditor",
  };
}

function isRole(value: unknown): value is UserRole {
  return (
    value === "officer" || value === "head" || value === "ops" || value === "auditor"
  );
}

/**
 * The signed-in user, or a redirect to the login page.
 * For pages — a redirect is the right answer for someone who is just not
 * signed in yet.
 */
export async function requireUser(returnTo?: string): Promise<SignedInUser> {
  const user = await currentUser();
  if (!user) {
    redirect(
      returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login",
    );
  }
  return user;
}

/**
 * The signed-in user, if they hold one of `roles`.
 *
 * Throws rather than redirects: this is called from server actions, where a
 * redirect would disguise a refused action as a navigation.
 */
export async function requireRole(
  roles: readonly UserRole[],
): Promise<SignedInUser> {
  const user = await currentUser();
  if (!user) throw new UnauthenticatedError();
  if (!roles.includes(user.role)) throw new ForbiddenError(roles, user.role);
  return user;
}

/** Page-level variant: sends the wrong role somewhere it is allowed to be. */
export async function requireRoleForPage(
  roles: readonly UserRole[],
  returnTo?: string,
): Promise<SignedInUser> {
  const user = await requireUser(returnTo);
  if (!roles.includes(user.role)) redirect("/dashboard?denied=1");
  return user;
}

/* -------------------------------------------------------------------------- */
/* Capabilities                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What each role may do. Used both to gate actions on the server and to decide
 * what to render, so the two can never drift apart.
 */
export const CAPABILITIES = {
  uploadCircular: ["officer"],
  reviewObligations: ["officer"],
  submitDraft: ["officer"],
  decideDraft: ["head"],
  viewAuditTrail: ["auditor", "head"],
} as const satisfies Record<string, readonly UserRole[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: UserRole, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly UserRole[]).includes(role);
}

/** Human-readable role, for badges and messages. */
export const ROLE_LABELS: Record<UserRole, string> = {
  officer: "Compliance Officer",
  head: "Head of Compliance",
  ops: "Operations",
  auditor: "Auditor",
};

/** One line on what each role is for, shown on the login screen. */
export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  officer: "Uploads circulars, reviews obligations, submits drafts",
  head: "Approves or rejects submitted drafts",
  ops: "Views rules and runs (deployment comes later)",
  auditor: "Read-only across the system, plus the audit trail",
};
