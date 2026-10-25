/**
 * Resets the demo to a clean, re-runnable state.
 *
 *   npm run demo:reset -- --yes
 *
 * Deletes every circular — cascading to its chunks and agent runs — removes the
 * draft and rejected rule versions the pipeline produced along with their
 * backtest runs, and puts the five seeded rules back on their live v1.
 *
 * Deliberately left alone:
 * - `user` and `transactions`, so the demo does not have to be re-seeded;
 * - `audit_log`, which is append-only by database trigger. The reset itself is
 *   recorded there as one new entry, which is the only honest way to represent
 *   a destructive action in an insert-only trail.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import {
  agentRuns,
  approvals,
  auditLog,
  backtestRuns,
  circularChunks,
  circulars,
  obligations,
  rules,
  ruleVersions,
} from "@/db/schema";
import { db } from "@/lib/db";

/** The rules the seed owns; their v1 is restored rather than deleted. */
const SEEDED_RULE_CODES = ["R-101", "R-102", "R-103", "R-104", "R-105"];

async function confirm(): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      "This deletes all circulars, draft rule versions and their backtests.\n" +
        "Users, transactions and audit_log are left untouched.\n" +
        "Type 'reset' to continue: ",
    );
    return answer.trim().toLowerCase() === "reset";
  } finally {
    rl.close();
  }
}

async function main() {
  const yes = process.argv.includes("--yes") || process.argv.includes("-y");

  if (!yes && !(await confirm())) {
    console.log("Aborted; nothing was changed.");
    return;
  }

  const before = {
    circulars: await count(circulars),
    chunks: await count(circularChunks),
    obligations: await count(obligations),
    agentRuns: await count(agentRuns),
    ruleVersions: await count(ruleVersions),
    backtestRuns: await count(backtestRuns),
  };

  /* -- 1. rule versions the pipeline produced ----------------------------- */

  // Anything not live: drafts the agents wrote, and anything a human rejected.
  // Their backtest runs and approvals go first — both reference the version.
  const disposable = await db
    .select({ id: ruleVersions.id })
    .from(ruleVersions)
    .where(ne(ruleVersions.status, "live"));
  const disposableIds = disposable.map((row) => row.id);

  let deletedBacktests = 0;
  let deletedApprovals = 0;
  if (disposableIds.length > 0) {
    // `backtest_runs` also points at a baseline version, so clear both sides.
    deletedBacktests = (
      await db
        .delete(backtestRuns)
        .where(inArray(backtestRuns.ruleVersionId, disposableIds))
        .returning({ id: backtestRuns.id })
    ).length;

    await db
      .update(backtestRuns)
      .set({ baselineVersionId: null })
      .where(inArray(backtestRuns.baselineVersionId, disposableIds));

    deletedApprovals = (
      await db
        .delete(approvals)
        .where(inArray(approvals.ruleVersionId, disposableIds))
        .returning({ id: approvals.id })
    ).length;
  }

  /* -- 2. circulars, cascading ------------------------------------------- */

  // `circular_chunks` and `agent_runs` cascade; `obligations` and the rule
  // versions that cite them do not, so they are cleared explicitly first.
  await db.update(ruleVersions).set({ obligationId: null });
  const deletedObligations = (
    await db.delete(obligations).returning({ id: obligations.id })
  ).length;
  const deletedCirculars = (
    await db.delete(circulars).returning({ id: circulars.id })
  ).length;

  /* -- 3. drop the non-live versions and any rule the demo invented ------- */

  const deletedVersions =
    disposableIds.length > 0
      ? (
          await db
            .delete(ruleVersions)
            .where(inArray(ruleVersions.id, disposableIds))
            .returning({ id: ruleVersions.id })
        ).length
      : 0;

  // Rules the pipeline invented (R-106 and up) have no version left at all.
  // Worked out in TypeScript rather than a hand-built SQL fragment: the set is
  // tiny and the intent is obvious here.
  const allRules = await db.select({ id: rules.id, code: rules.code }).from(rules);
  const ruleIdsWithVersions = new Set(
    (await db.select({ ruleId: ruleVersions.ruleId }).from(ruleVersions)).map(
      (row) => row.ruleId,
    ),
  );
  const orphanRules = allRules.filter(
    (rule) =>
      !SEEDED_RULE_CODES.includes(rule.code) &&
      !ruleIdsWithVersions.has(rule.id),
  );
  if (orphanRules.length > 0) {
    await db.delete(rules).where(
      inArray(
        rules.id,
        orphanRules.map((r) => r.id),
      ),
    );
  }

  /* -- 4. restore the seeded rules to their live v1 ----------------------- */

  const restored: string[] = [];
  for (const code of SEEDED_RULE_CODES) {
    const [rule] = await db
      .select({ id: rules.id })
      .from(rules)
      .where(eq(rules.code, code))
      .limit(1);
    if (!rule) continue;

    const [v1] = await db
      .select({ id: ruleVersions.id })
      .from(ruleVersions)
      .where(and(eq(ruleVersions.ruleId, rule.id), eq(ruleVersions.version, 1)))
      .limit(1);
    if (!v1) continue;

    await db
      .update(ruleVersions)
      .set({ status: "live" })
      .where(eq(ruleVersions.id, v1.id));
    await db
      .update(rules)
      .set({ currentVersionId: v1.id })
      .where(eq(rules.id, rule.id));
    restored.push(code);
  }

  /* -- 5. record the reset ------------------------------------------------ */

  await db.insert(auditLog).values({
    actor: "script:demo-reset",
    action: "demo.reset",
    entityType: "system",
    entityId: "demo",
    details: {
      deleted: {
        circulars: deletedCirculars,
        obligations: deletedObligations,
        rule_versions: deletedVersions,
        backtest_runs: deletedBacktests,
        approvals: deletedApprovals,
        orphan_rules: orphanRules.map((r) => r.code),
      },
      restored_to_live_v1: restored,
      preserved: ["user", "transactions", "audit_log"],
    },
  });

  const after = {
    circulars: await count(circulars),
    chunks: await count(circularChunks),
    obligations: await count(obligations),
    agentRuns: await count(agentRuns),
    ruleVersions: await count(ruleVersions),
    backtestRuns: await count(backtestRuns),
  };

  console.log("Demo reset\n");
  console.log("  table           before   after");
  for (const key of Object.keys(before) as Array<keyof typeof before>) {
    console.log(
      `  ${key.padEnd(14)} ${String(before[key]).padStart(6)}  ${String(after[key]).padStart(6)}`,
    );
  }
  console.log(`\n  rules restored to live v1: ${restored.join(", ") || "(none)"}`);
  if (orphanRules.length > 0) {
    console.log(`  rules removed:             ${orphanRules.map((r) => r.code).join(", ")}`);
  }
  console.log(`  approvals deleted:         ${deletedApprovals}`);
  console.log("  untouched:                 user, transactions, audit_log");
  console.log("  audit_log:                 one 'demo.reset' entry written");
}

async function count(table: PgTable): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return row.n;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\ndemo reset failed:");
    console.error(error);
    process.exit(1);
  });
