/**
 * End-to-end check of the rule contract, the engine and the backtester.
 *
 * Run with `npm run check:rules` (after `npm run db:seed`). It:
 * 1. validates every seeded rule and prints its plain-English form;
 * 2. confirms a rule naming an unknown field is rejected;
 * 3. confirms a rule using a forbidden operator is rejected;
 * 4. backtests R-101 with its threshold halved, against the live version.
 *
 * Written as a script rather than a test because there is no test runner in
 * the project yet, and it needs a seeded database to mean anything.
 */
import { and, asc, eq } from "drizzle-orm";
import type { RulesLogic } from "json-logic-js";

import { rules, ruleVersions } from "@/db/schema";
import { db } from "@/lib/db";
import { runBacktest } from "@/rules/backtest";
import { diffRules, explainRule } from "@/rules/engine";
import { validateRule, type RuleLogic } from "@/rules/schema";

let failures = 0;

function heading(text: string) {
  console.log(`\n${text}`);
  console.log("-".repeat(text.length));
}

function pass(text: string) {
  console.log(`  PASS  ${text}`);
}

function fail(text: string) {
  failures += 1;
  console.log(`  FAIL  ${text}`);
}

/* 1 — every seeded rule satisfies the contract ----------------------------- */

async function checkSeededRules() {
  heading("1. Seeded rules validate against the contract");

  const seeded = await db
    .select({
      code: rules.code,
      name: rules.name,
      versionId: ruleVersions.id,
      jsonLogic: ruleVersions.jsonLogic,
    })
    .from(rules)
    .innerJoin(ruleVersions, eq(ruleVersions.id, rules.currentVersionId))
    .orderBy(asc(rules.code));

  if (seeded.length === 0) {
    fail("no rules found — run `npm run db:seed` first");
    return;
  }

  for (const rule of seeded) {
    const { ok, errors } = validateRule(rule.jsonLogic);
    if (ok) {
      pass(`${rule.code} ${rule.name}`);
      console.log(`        ${explainRule(rule.jsonLogic)}`);
    } else {
      fail(`${rule.code}: ${errors.join("; ")}`);
    }
  }

  console.log(`\n  ${seeded.length} rules checked`);
}

/* 2 and 3 — unsafe rules are rejected -------------------------------------- */

function expectRejected(label: string, logic: unknown, mustMention: string) {
  const { ok, errors } = validateRule(logic);
  if (ok) {
    fail(`${label} was accepted but should have been rejected`);
    return;
  }
  if (!errors.some((e) => e.includes(mustMention))) {
    fail(
      `${label} was rejected, but no error mentioned "${mustMention}": ${errors.join("; ")}`,
    );
    return;
  }
  pass(`${label} rejected`);
  for (const error of errors) console.log(`        ${error}`);
}

function checkRejections() {
  heading("2. A rule naming an unknown field is rejected");
  expectRejected(
    'unknown field "salary"',
    {
      and: [
        { "==": [{ var: "type" }, "transfer"] },
        { ">=": [{ var: "salary" }, 100000] },
      ],
    },
    "unknown transaction field",
  );

  heading("3. A rule using a forbidden operator is rejected");
  expectRejected(
    'arithmetic operator "+"',
    { ">=": [{ "+": [{ var: "amount" }, 1000] }, 100000] },
    "is not allowed",
  );

  heading("3b. Further contract violations");
  expectRejected(
    'substring matching via "in"',
    { in: [{ var: "branch" }, "Mumbai"] },
    "substring matching",
  );
  expectRejected(
    '"var" with a fallback value',
    { "==": [{ var: ["country", "IN"] }, "IN"] },
    "fallback",
  );
  expectRejected("a bare literal rule", true, "must be a condition");
}

/* 4 — backtest a halved threshold ----------------------------------------- */

const CANDIDATE_VERSION = 2;
const NEW_THRESHOLD = 500_000;

async function checkBacktest() {
  heading(`4. Backtest R-101 with the threshold at ${NEW_THRESHOLD}`);

  const [rule] = await db
    .select({ id: rules.id, currentVersionId: rules.currentVersionId })
    .from(rules)
    .where(eq(rules.code, "R-101"))
    .limit(1);

  if (!rule?.currentVersionId) {
    fail("R-101 has no live version — run `npm run db:seed` first");
    return;
  }

  const [live] = await db
    .select({ id: ruleVersions.id, jsonLogic: ruleVersions.jsonLogic })
    .from(ruleVersions)
    .where(eq(ruleVersions.id, rule.currentVersionId))
    .limit(1);

  const candidateLogic: RuleLogic = {
    and: [
      { "==": [{ var: "type" }, "cash_deposit"] },
      { "==": [{ var: "currency" }, "INR"] },
      { ">=": [{ var: "amount" }, NEW_THRESHOLD] },
    ],
  };

  // Idempotent: version 2 of R-101 is created once and reused on later runs.
  await db
    .insert(ruleVersions)
    .values({
      ruleId: rule.id,
      version: CANDIDATE_VERSION,
      jsonLogic: candidateLogic as RulesLogic,
      status: "draft",
      changeSummary: `Threshold lowered to ${NEW_THRESHOLD} (check script)`,
      createdByAgent: "check-rules",
    })
    .onConflictDoNothing({
      target: [ruleVersions.ruleId, ruleVersions.version],
    });

  const [candidate] = await db
    .select({ id: ruleVersions.id })
    .from(ruleVersions)
    .where(
      and(
        eq(ruleVersions.ruleId, rule.id),
        eq(ruleVersions.version, CANDIDATE_VERSION),
      ),
    )
    .limit(1);

  console.log(`  baseline:  ${explainRule(live.jsonLogic)}`);
  console.log(`  candidate: ${explainRule(candidateLogic)}`);
  console.log("  diff:");
  for (const change of diffRules(live.jsonLogic, candidateLogic)) {
    console.log(`    - [${change.kind}] ${change.message}`);
  }

  const started = Date.now();
  const summary = await runBacktest({
    candidateVersionId: candidate.id,
    baselineVersionId: live.id,
    actor: "script:check-rules",
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n  backtest completed in ${seconds}s`);
  console.log(`    backtest_run_id:     ${summary.backtest_run_id}`);
  console.log(`    total_txns:          ${summary.total_txns}`);
  console.log(`    old_alerts:          ${summary.old_alerts}`);
  console.log(`    new_alerts:          ${summary.new_alerts}`);
  console.log(`    alerts_added:        ${summary.alerts_added}`);
  console.log(`    alerts_removed:      ${summary.alerts_removed}`);
  console.log(`    customers_affected:  ${summary.customers_affected}`);
  console.log(`    sample changed txns:`);
  for (const id of summary.sample_changed_txn_ids) {
    console.log(`      ${id}`);
  }

  if (summary.total_txns === 0) {
    fail("backtest saw no transactions");
  } else if (summary.alerts_added <= 0) {
    fail("lowering the threshold added no alerts — seed data is not straddling it");
  } else {
    pass(
      `lowering the threshold added ${summary.alerts_added} alerts across ${summary.customers_affected} customers`,
    );
  }
}

async function main() {
  await checkSeededRules();
  checkRejections();
  await checkBacktest();

  console.log(
    failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\ncheck-rules failed:");
  console.error(error);
  process.exit(1);
});
