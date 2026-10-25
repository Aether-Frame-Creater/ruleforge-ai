"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { approvals, rules, ruleVersions } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";

import { failure, parseInput, toActionError, writeAudit, type ActionResult } from "./shared";

const submitSchema = z.object({
  ruleVersionId: z.string().uuid(),
});

/**
 * Puts a draft forward for approval.
 *
 * Officers only, and only from `draft`: re-submitting something already
 * decided would quietly reopen a closed decision.
 */
export async function submitDraftAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const user = await requireRole(["officer"]);
    const parsed = parseInput(submitSchema, input);
    if (!parsed.ok) return parsed.result;

    const [version] = await db
      .select({
        id: ruleVersions.id,
        status: ruleVersions.status,
        version: ruleVersions.version,
        ruleId: ruleVersions.ruleId,
      })
      .from(ruleVersions)
      .where(eq(ruleVersions.id, parsed.data.ruleVersionId))
      .limit(1);

    if (!version) return failure("That rule version no longer exists.");
    if (version.status !== "draft") {
      return failure(
        `This version is already ${version.status}; only a draft can be submitted.`,
      );
    }

    await db
      .update(ruleVersions)
      .set({
        status: "submitted",
        submittedBy: user.id,
        submittedAt: new Date(),
      })
      .where(
        // Re-checking the status in the UPDATE closes the gap between the read
        // above and this write, where two officers could both submit.
        and(eq(ruleVersions.id, version.id), eq(ruleVersions.status, "draft")),
      );

    await writeAudit({
      actor: `user:${user.email}`,
      action: "rule_version.submitted",
      entityType: "rule_versions",
      entityId: version.id,
      details: { rule_id: version.ruleId, version: version.version },
    });

    revalidatePath("/approvals");
    revalidatePath(`/drafts/${version.id}`);
    revalidatePath("/rules");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

const decisionSchema = z.object({
  ruleVersionId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  comment: z
    .string()
    .trim()
    .min(10, "A comment of at least 10 characters is required.")
    .max(1000, "Keep the comment under 1000 characters."),
});

/**
 * Records a head's decision on a submitted draft.
 *
 * Approving does not deploy anything: the version moves to `approved` and the
 * live version is untouched. Rollout is a separate, later step.
 */
export async function decideDraftAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const user = await requireRole(["head"]);
    const parsed = parseInput(decisionSchema, input);
    if (!parsed.ok) return parsed.result;

    const [version] = await db
      .select({
        id: ruleVersions.id,
        status: ruleVersions.status,
        version: ruleVersions.version,
        ruleId: ruleVersions.ruleId,
        submittedBy: ruleVersions.submittedBy,
      })
      .from(ruleVersions)
      .where(eq(ruleVersions.id, parsed.data.ruleVersionId))
      .limit(1);

    if (!version) return failure("That rule version no longer exists.");
    if (version.status !== "submitted") {
      return failure(
        `This version is ${version.status}; only a submitted draft can be decided.`,
      );
    }
    if (!version.submittedBy) {
      return failure(
        "This version has no recorded submitter, so maker-checker cannot be enforced.",
      );
    }

    // Maker-checker. The database enforces this too, with a CHECK constraint on
    // approvals; refusing here means the user gets a sentence instead of a
    // constraint violation.
    if (version.submittedBy === user.id) {
      return failure(
        "You submitted this draft, so you cannot also approve it. It needs a different approver.",
      );
    }

    await db.insert(approvals).values({
      ruleVersionId: version.id,
      makerId: version.submittedBy,
      checkerId: user.id,
      decision: parsed.data.decision,
      comment: parsed.data.comment,
    });

    await db
      .update(ruleVersions)
      .set({ status: parsed.data.decision })
      .where(
        and(
          eq(ruleVersions.id, version.id),
          eq(ruleVersions.status, "submitted"),
        ),
      );

    await writeAudit({
      actor: `user:${user.email}`,
      action: `rule_version.${parsed.data.decision}`,
      entityType: "rule_versions",
      entityId: version.id,
      details: {
        rule_id: version.ruleId,
        version: version.version,
        maker_id: version.submittedBy,
        checker_id: user.id,
        comment: parsed.data.comment,
      },
    });

    revalidatePath("/approvals");
    revalidatePath(`/drafts/${version.id}`);
    revalidatePath("/rules");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** Rule and version, for pages that need to name what they are showing. */
export async function ruleForVersion(ruleVersionId: string) {
  const [row] = await db
    .select({ code: rules.code, name: rules.name })
    .from(ruleVersions)
    .innerJoin(rules, eq(rules.id, ruleVersions.ruleId))
    .where(eq(ruleVersions.id, ruleVersionId))
    .limit(1);
  return row ?? null;
}
