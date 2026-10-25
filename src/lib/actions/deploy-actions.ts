"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/guards";
import {
  MIN_ROLLBACK_REASON,
  ROLLOUT_STAGES,
  RolloutGuardrailError,
  rollback,
  runShadowComparison,
  setRollout,
  startShadow,
  type DeployActor,
} from "@/rules/deploy";

import { failure, parseInput, toActionError, type ActionResult } from "./shared";

/**
 * Server actions for deployment.
 *
 * These are a thin shell: they establish *who* is acting and hand that to
 * `src/rules/deploy.ts`, which does the role check again and owns the
 * transaction and the audit entry. The duplication is deliberate — the deploy
 * module must be safe to call from anywhere, not only from behind these.
 */

/** Every deployment path revalidates the same set of pages. */
function revalidateDeploymentViews(versionId?: string) {
  revalidatePath("/rollout");
  revalidatePath("/rules");
  revalidatePath("/dashboard");
  if (versionId) revalidatePath(`/rollout/${versionId}`);
}

/** The ops user, shaped for the deploy module. */
async function opsActor(): Promise<DeployActor> {
  const user = await requireRole(["ops"]);
  return { id: user.id, email: user.email, role: user.role };
}

const versionSchema = z.object({ ruleVersionId: z.string().uuid() });

export async function startShadowAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const parsed = parseInput(versionSchema, input);
    if (!parsed.ok) return parsed.result;

    await startShadow(parsed.data.ruleVersionId, await opsActor());
    revalidateDeploymentViews(parsed.data.ruleVersionId);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

const shadowRunSchema = z.object({
  ruleVersionId: z.string().uuid(),
  simulate: z.boolean().default(false),
});

export async function runShadowComparisonAction(
  input: unknown,
): Promise<
  ActionResult<{
    liveAlerts: number;
    shadowAlerts: number;
    alertsOnlyShadow: number;
    alertsOnlyLive: number;
    txnsEvaluated: number;
    alertRateChangePct: number | null;
  }>
> {
  try {
    const parsed = parseInput(shadowRunSchema, input);
    if (!parsed.ok) return parsed.result;

    const result = await runShadowComparison(
      parsed.data.ruleVersionId,
      { simulate: parsed.data.simulate },
      await opsActor(),
    );
    revalidateDeploymentViews(parsed.data.ruleVersionId);

    return {
      ok: true,
      data: {
        liveAlerts: result.liveAlerts,
        shadowAlerts: result.shadowAlerts,
        alertsOnlyShadow: result.alertsOnlyShadow,
        alertsOnlyLive: result.alertsOnlyLive,
        txnsEvaluated: result.txnsEvaluated,
        alertRateChangePct: result.alertRateChangePct,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

const rolloutSchema = z.object({
  ruleVersionId: z.string().uuid(),
  percent: z
    .number()
    .int()
    .refine(
      (value) => (ROLLOUT_STAGES as readonly number[]).includes(value),
      `Rollout must be one of ${ROLLOUT_STAGES.join(", ")} percent.`,
    ),
  guardrailAcknowledgement: z.string().optional(),
});

export async function setRolloutAction(
  input: unknown,
): Promise<
  ActionResult<{ status: string; percent: number }> | ActionResult<never>
> {
  try {
    const parsed = parseInput(rolloutSchema, input);
    if (!parsed.ok) return parsed.result;

    const result = await setRollout(
      parsed.data.ruleVersionId,
      parsed.data.percent,
      await opsActor(),
      { guardrailAcknowledgement: parsed.data.guardrailAcknowledgement },
    );
    revalidateDeploymentViews(parsed.data.ruleVersionId);
    return { ok: true, data: { status: result.status, percent: result.percent } };
  } catch (error) {
    // The guardrail is a prompt for confirmation, not a fault: its message is
    // what the operator needs to read before typing a reason.
    if (error instanceof RolloutGuardrailError) {
      return failure(error.message, {
        guardrailAcknowledgement: [
          `Alerts rise by ${error.alertRateChangePct.toFixed(0)}%. Type a reason to proceed.`,
        ],
      });
    }
    return toActionError(error);
  }
}

const rollbackSchema = z.object({
  ruleId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(
      MIN_ROLLBACK_REASON,
      `A reason of at least ${MIN_ROLLBACK_REASON} characters is required.`,
    )
    .max(1000, "Keep the reason under 1000 characters."),
});

export async function rollbackAction(
  input: unknown,
): Promise<ActionResult<{ restoredVersion: number }>> {
  try {
    const parsed = parseInput(rollbackSchema, input);
    if (!parsed.ok) return parsed.result;

    const result = await rollback(
      parsed.data.ruleId,
      parsed.data.reason,
      await opsActor(),
    );
    revalidateDeploymentViews();
    return { ok: true, data: { restoredVersion: result.restoredVersion } };
  } catch (error) {
    return toActionError(error);
  }
}
