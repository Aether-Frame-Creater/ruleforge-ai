/**
 * Guard checks for the deployment layer.
 *
 * Calls `src/rules/deploy.ts` directly — bypassing the UI and the server
 * actions — because that is exactly how an agent or a stray script would reach
 * it. The point is that the module refuses on its own, not that a page
 * remembered to hide a button.
 *
 *   npm run check:deploy      (after `npm run db:seed`)
 */
import { eq } from "drizzle-orm";

import { rules, ruleVersions, user } from "@/db/schema";
import { db } from "@/lib/db";
import { closeTxPool } from "@/lib/db/tx";
import type { UserRole } from "@/lib/auth";
import {
  DeploymentForbiddenError,
  DeploymentStateError,
  rollback,
  runShadowComparison,
  setRollout,
  startShadow,
  isCustomerInRollout,
  type DeployActor,
} from "@/rules/deploy";

let failures = 0;
const pass = (m: string) => console.log(`  PASS  ${m}`);
const fail = (m: string) => {
  failures += 1;
  console.log(`  FAIL  ${m}`);
};
const step = (m: string) => console.log(`\n${m}\n${"-".repeat(m.length)}`);

async function actorFor(role: UserRole): Promise<DeployActor> {
  const [row] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.email, `${role}@ruleforge.demo`))
    .limit(1);
  if (!row) throw new Error(`${role}@ruleforge.demo is missing; run db:seed.`);
  return { id: row.id, email: row.email, role };
}

/** Asserts a call is refused, and that the refusal says why. */
async function expectRefused(
  label: string,
  run: () => Promise<unknown>,
  expect: { type: "forbidden" | "state"; mentions: string },
) {
  try {
    await run();
    fail(`${label} was allowed`);
  } catch (error) {
    const isRight =
      expect.type === "forbidden"
        ? error instanceof DeploymentForbiddenError
        : error instanceof DeploymentStateError;
    const message = error instanceof Error ? error.message : String(error);

    if (!isRight) {
      fail(`${label} was refused with the wrong error: ${message}`);
      return;
    }
    if (!message.toLowerCase().includes(expect.mentions.toLowerCase())) {
      fail(`${label} refused, but the message did not mention "${expect.mentions}": ${message}`);
      return;
    }
    pass(`${label} refused: ${message.slice(0, 90)}`);
  }
}

async function main() {
  step("1. Only ops may deploy");

  const [v1] = await db
    .select({ id: ruleVersions.id, ruleId: ruleVersions.ruleId })
    .from(ruleVersions)
    .innerJoin(rules, eq(rules.id, ruleVersions.ruleId))
    .where(eq(rules.code, "R-101"))
    .limit(1);

  if (!v1) {
    fail("R-101 has no version; run `npm run db:seed`.");
    return;
  }

  for (const role of ["officer", "head", "auditor"] as const) {
    const actor = await actorFor(role);
    await expectRefused(
      `startShadow as ${role}`,
      () => startShadow(v1.id, actor),
      { type: "forbidden", mentions: "operations role" },
    );
  }

  step("2. An agent code path cannot deploy");

  // This is what an agent has: no session, no user row. Every shape of it is
  // refused before any state is touched.
  const agentShapes: Array<[string, unknown]> = [
    ["null actor", null],
    ["undefined actor", undefined],
    ["agent pseudo-actor", { id: "", email: "agent:orchestrator", role: "ops" }],
    ["agent with a forged role", { id: "agent", email: "agent:x", role: "agent" }],
  ];

  for (const [label, shape] of agentShapes) {
    await expectRefused(
      label,
      () => startShadow(v1.id, shape as DeployActor),
      {
        type: "forbidden",
        mentions: shape && (shape as DeployActor).id ? "operations role" : "signed-in",
      },
    );
  }

  for (const [label, shape] of agentShapes.slice(0, 1)) {
    await expectRefused(
      `${label} → setRollout`,
      () => setRollout(v1.id, 100, shape as DeployActor),
      { type: "forbidden", mentions: "signed-in" },
    );
    await expectRefused(
      `${label} → rollback`,
      () => rollback(v1.ruleId, "an agent should never reach this", shape as DeployActor),
      { type: "forbidden", mentions: "signed-in" },
    );
    await expectRefused(
      `${label} → runShadowComparison`,
      () => runShadowComparison(v1.id, { simulate: false }, shape as DeployActor),
      { type: "forbidden", mentions: "signed-in" },
    );
  }

  step("3. State rules");

  const ops = await actorFor("ops");

  await expectRefused(
    "startShadow on a live version",
    () => startShadow(v1.id, ops),
    { type: "state", mentions: "approved version" },
  );

  await expectRefused(
    "setRollout on a version that was never shadowed",
    () => setRollout(v1.id, 10, ops),
    { type: "state", mentions: "shadow" },
  );

  await expectRefused(
    "setRollout at a percentage that is not a stage",
    () => setRollout(v1.id, 25, ops),
    { type: "state", mentions: "10, 50, 100" },
  );

  await expectRefused(
    "rollback with a short reason",
    () => rollback(v1.ruleId, "bad", ops),
    { type: "state", mentions: "at least 10 characters" },
  );

  step("4. The rollout hash is stable and roughly proportional");

  const sample = Array.from(
    { length: 2000 },
    (_, i) => `CUST-${String(i + 1).padStart(6, "0")}`,
  );

  const first = sample.filter((id) => isCustomerInRollout(id, 10)).length;
  const again = sample.filter((id) => isCustomerInRollout(id, 10)).length;

  if (first === again) pass(`the same customers are selected every time (${first}/2000 at 10%)`);
  else fail("the rollout selection changed between calls");

  const atTen = first / sample.length;
  if (atTen > 0.05 && atTen < 0.16) {
    pass(`10% selects ${(atTen * 100).toFixed(1)}% of customers`);
  } else {
    fail(`10% selected ${(atTen * 100).toFixed(1)}% of customers, which is not close to 10%`);
  }

  const atFifty = sample.filter((id) => isCustomerInRollout(id, 50)).length;
  const tenSet = new Set(sample.filter((id) => isCustomerInRollout(id, 10)));
  const fiftyCoversTen = [...tenSet].every((id) => isCustomerInRollout(id, 50));

  if (fiftyCoversTen) pass("widening to 50% keeps every customer who was on 10%");
  else fail("widening the rollout moved customers off the new rule");

  if (sample.every((id) => isCustomerInRollout(id, 100))) {
    pass("100% selects every customer");
  } else {
    fail("100% did not select every customer");
  }
  if (!sample.some((id) => isCustomerInRollout(id, 0))) {
    pass("0% selects nobody");
  } else {
    fail("0% selected somebody");
  }
  console.log(`        10%: ${first}/2000, 50%: ${atFifty}/2000`);

  console.log(
    failures === 0
      ? "\nAll deployment guard checks passed."
      : `\n${failures} check(s) failed.`,
  );
  await closeTxPool();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\ncheck-deploy failed:");
  console.error(error);
  await closeTxPool().catch(() => {});
  process.exit(1);
});
