/**
 * Impact agent (LITE model).
 *
 * Turns backtest counts into something a committee can read, and assigns a risk
 * level. It is given numbers that were computed in code — it does not run the
 * backtest and must not contradict the figures it is shown.
 */
import { z } from "zod";

import { GEMINI_MODEL_LITE } from "@/lib/ai/gemini";
import type { BacktestSummary } from "@/rules/backtest";

import {
  defineAgent,
  envelope,
  invokeAgent,
  type PipelineContext,
} from "./runtime";

export const impactOutputSchema = z.object({
  summary: z
    .string()
    .describe(
      "Two or three sentences in plain English: what changes operationally, " +
        "quoting the figures you were given.",
    ),
  risk_level: z
    .enum(["low", "medium", "high"])
    .describe("Operational risk of adopting this change."),
  drivers: z
    .array(z.string())
    .describe("The one to three factors that drove the risk level."),
});

export type ImpactAssessment = z.infer<typeof impactOutputSchema>;

const INSTRUCTION = `
You brief a bank's compliance committee on the effect of a proposed rule change.

You are given the measured result of a backtest over historical transactions.
The numbers are authoritative: quote them, never adjust or re-estimate them.

Write for a reader who will not look at json-logic. Say what the change does,
how many more or fewer alerts it produces, and how many customers are touched.

Risk level:
- low: a small, well-understood change in alert volume that existing staffing absorbs.
- medium: a material increase in alerts, or a noticeable operational load.
- high: alerts rise several-fold, a large share of customers is newly affected,
  or the change removes alerts that were previously raised.

Removing alerts that the rule in force would have raised is always at least
medium risk: it narrows surveillance.
`.trim();

export function createImpactAgent() {
  return defineAgent({
    name: "impact_agent",
    model: GEMINI_MODEL_LITE,
    description: "Summarises a backtest result and assigns a risk level.",
    instruction: INSTRUCTION,
    outputSchema: impactOutputSchema,
    // Rewrites numbers it is given; no deliberation required.
    thinking: "minimal",
    temperature: 0.2,
  });
}

export async function runImpactAgent(
  ctx: PipelineContext,
  params: {
    ruleCode: string;
    backtest: BacktestSummary;
    changeSummary: string;
    concurrent?: boolean;
  },
): Promise<ImpactAssessment> {
  const { backtest } = params;
  const pct =
    backtest.old_alerts > 0
      ? `${(((backtest.new_alerts - backtest.old_alerts) / backtest.old_alerts) * 100).toFixed(0)}%`
      : "n/a (no alerts before)";

  return invokeAgent({
    ctx,
    name: "impact_agent",
    agent: createImpactAgent(),
    schema: impactOutputSchema,
    concurrent: params.concurrent,
    request: envelope("orchestrator", "impact_agent", "request", {
      rule_code: params.ruleCode,
      backtest_run_id: backtest.backtest_run_id,
    }),
    parts: [
      {
        text: [
          `RULE: ${params.ruleCode}`,
          `PROPOSED CHANGE: ${params.changeSummary}`,
          `RULE IN FORCE:  ${backtest.baseline_explanation ?? "(no rule in force)"}`,
          `PROPOSED RULE:  ${backtest.candidate_explanation}`,
          "",
          "BACKTEST RESULT (measured in code, authoritative):",
          `  transactions examined: ${backtest.total_txns}`,
          `  alerts under the rule in force: ${backtest.old_alerts}`,
          `  alerts under the proposed rule: ${backtest.new_alerts}`,
          `  alerts added: ${backtest.alerts_added}`,
          `  alerts removed: ${backtest.alerts_removed}`,
          `  change in alert volume: ${pct}`,
          `  distinct customers affected: ${backtest.customers_affected}`,
          "",
          "Brief the committee.",
        ].join("\n"),
      },
    ],
  });
}
