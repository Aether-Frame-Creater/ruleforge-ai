/**
 * Backtesting: replay a candidate rule version over stored transactions and
 * measure what it would have changed against the version currently in force.
 *
 * This is the evidence a human approver sees before a rule goes anywhere near
 * production, so the run is recorded in `backtest_runs` and in `audit_log`.
 */
import { and, asc, eq, gt } from "drizzle-orm";

import { auditLog, backtestRuns, ruleVersions, transactions } from "@/db/schema";
import { db } from "@/lib/db";

import { compileRule, diffRules, explainRule, NEVER_FIRES } from "./engine";
import type { RuleDiff } from "./engine";

/** Transactions are read in pages of this size, never all at once. */
export const BACKTEST_BATCH_SIZE = 5_000;

/** How many changed transaction ids to keep as evidence. */
export const SAMPLE_SIZE = 10;

export interface RunBacktestOptions {
  candidateVersionId: string;
  /** Omit when no rule was in force before; the baseline then never fires. */
  baselineVersionId?: string | null;
  /** Who to record in the audit trail. */
  actor?: string;
}

export interface BacktestSummary {
  backtest_run_id: string;
  candidate_version_id: string;
  baseline_version_id: string | null;
  total_txns: number;
  old_alerts: number;
  new_alerts: number;
  alerts_added: number;
  alerts_removed: number;
  customers_affected: number;
  /** Up to {@link SAMPLE_SIZE} transaction ids whose outcome changed. */
  sample_changed_txn_ids: string[];
  candidate_explanation: string;
  baseline_explanation: string | null;
  diff: RuleDiff[];
}

async function loadVersion(id: string) {
  const [version] = await db
    .select({
      id: ruleVersions.id,
      ruleId: ruleVersions.ruleId,
      version: ruleVersions.version,
      jsonLogic: ruleVersions.jsonLogic,
    })
    .from(ruleVersions)
    .where(eq(ruleVersions.id, id))
    .limit(1);

  if (!version) {
    throw new Error(`rule version ${id} does not exist`);
  }
  return version;
}

/**
 * Runs a backtest, stores the result and returns the summary.
 *
 * Transactions are paged by `id` rather than `LIMIT/OFFSET`: a keyset walk
 * cannot skip or double-count a row if the table is written to mid-run.
 */
export async function runBacktest({
  candidateVersionId,
  baselineVersionId = null,
  actor = "agent:backtester",
}: RunBacktestOptions): Promise<BacktestSummary> {
  const candidate = await loadVersion(candidateVersionId);
  const baseline = baselineVersionId
    ? await loadVersion(baselineVersionId)
    : null;

  if (baseline && baseline.id === candidate.id) {
    throw new Error(
      "candidateVersionId and baselineVersionId are the same version; there is nothing to compare",
    );
  }

  // Validated once, here, before a single transaction is read.
  const evaluateCandidate = compileRule(candidate.jsonLogic);
  const evaluateBaseline = baseline
    ? compileRule(baseline.jsonLogic)
    : NEVER_FIRES;

  let totalTxns = 0;
  let oldAlerts = 0;
  let newAlerts = 0;
  let alertsAdded = 0;
  let alertsRemoved = 0;
  const affectedCustomers = new Set<string>();
  const sampleChanged: string[] = [];

  let cursor: string | null = null;
  for (;;) {
    const batch = await db
      .select({
        id: transactions.id,
        customerId: transactions.customerId,
        amount: transactions.amount,
        currency: transactions.currency,
        type: transactions.type,
        channel: transactions.channel,
        branch: transactions.branch,
        country: transactions.country,
      })
      .from(transactions)
      // Seeded rows only. Shadow simulations add rows to this table, and a
      // backtest whose corpus grew between runs is not comparable with the
      // one a reviewer approved.
      .where(
        and(
          eq(transactions.isSyntheticSim, false),
          cursor ? gt(transactions.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(transactions.id))
      .limit(BACKTEST_BATCH_SIZE);

    if (batch.length === 0) break;

    for (const txn of batch) {
      totalTxns += 1;
      const before = evaluateBaseline(txn);
      const after = evaluateCandidate(txn);

      if (before) oldAlerts += 1;
      if (after) newAlerts += 1;

      if (before !== after) {
        if (after) alertsAdded += 1;
        else alertsRemoved += 1;
        affectedCustomers.add(txn.customerId);
        if (sampleChanged.length < SAMPLE_SIZE) sampleChanged.push(txn.id);
      }
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BACKTEST_BATCH_SIZE) break;
  }

  const candidateExplanation = explainRule(candidate.jsonLogic);
  const baselineExplanation = baseline
    ? explainRule(baseline.jsonLogic)
    : null;
  const diff = baseline
    ? diffRules(baseline.jsonLogic, candidate.jsonLogic)
    : [];

  const resultJson = {
    alerts_added: alertsAdded,
    alerts_removed: alertsRemoved,
    sample_changed_txn_ids: sampleChanged,
    candidate_explanation: candidateExplanation,
    baseline_explanation: baselineExplanation,
    diff,
    batch_size: BACKTEST_BATCH_SIZE,
    ran_at: new Date().toISOString(),
  };

  const [run] = await db
    .insert(backtestRuns)
    .values({
      ruleVersionId: candidate.id,
      baselineVersionId: baseline?.id ?? null,
      totalTxns,
      oldAlerts,
      newAlerts,
      customersAffected: affectedCustomers.size,
      resultJson,
    })
    .returning({ id: backtestRuns.id });

  await db.insert(auditLog).values({
    actor,
    action: "backtest.completed",
    entityType: "backtest_runs",
    entityId: run.id,
    details: {
      candidate_version_id: candidate.id,
      baseline_version_id: baseline?.id ?? null,
      rule_id: candidate.ruleId,
      total_txns: totalTxns,
      old_alerts: oldAlerts,
      new_alerts: newAlerts,
      alerts_added: alertsAdded,
      alerts_removed: alertsRemoved,
      customers_affected: affectedCustomers.size,
    },
  });

  return {
    backtest_run_id: run.id,
    candidate_version_id: candidate.id,
    baseline_version_id: baseline?.id ?? null,
    total_txns: totalTxns,
    old_alerts: oldAlerts,
    new_alerts: newAlerts,
    alerts_added: alertsAdded,
    alerts_removed: alertsRemoved,
    customers_affected: affectedCustomers.size,
    sample_changed_txn_ids: sampleChanged,
    candidate_explanation: candidateExplanation,
    baseline_explanation: baselineExplanation,
    diff,
  };
}
