/**
 * Mapping agent (MAIN model).
 *
 * Given the obligations and the rules currently in force — each rendered in
 * plain English by `explainRule`, not as json-logic — decides for each
 * obligation whether an existing rule should change, a new rule is needed, or
 * nothing in the rule base is affected.
 *
 * Most obligations in a real circular are process requirements (file a report
 * within seven days, keep records for five years) that no transaction rule can
 * express. "No rule change" is the expected answer far more often than not.
 */
import { z } from "zod";

import { GEMINI_MODEL } from "@/lib/ai/gemini";

import {
  defineAgent,
  envelope,
  invokeAgent,
  untrustedBlock,
  type PipelineContext,
} from "./runtime";
import type { StoredObligation } from "./types";

/** An existing rule, as shown to the mapping agent. */
export interface ExistingRuleSummary {
  ruleId: string;
  code: string;
  name: string;
  category: string;
  /** `explainRule()` output for the live version. */
  explanation: string;
  currentVersionId: string | null;
  currentVersion: number | null;
}

export const mappingOutputSchema = z.object({
  decisions: z.array(
    z.object({
      obligation_index: z
        .number()
        .int()
        .describe("Index of the obligation in the list you were given."),
      decision: z
        .enum(["modify_existing", "new_rule", "no_rule_change"])
        .describe("What the rule base needs."),
      rule_code: z
        .string()
        .describe(
          'The existing rule code for modify_existing, e.g. "R-101". Use "none" otherwise.',
        ),
      proposed_category: z
        .enum(["aml", "kyc", "lending", "fraud"])
        .describe("Category for a new rule; for other decisions, your best guess."),
      rationale: z
        .string()
        .describe("One or two sentences explaining the decision."),
    }),
  ),
});

export type MappingOutput = z.infer<typeof mappingOutputSchema>;

export interface MappingDecision {
  obligationId: string;
  obligationSummary: string;
  paragraphRef: string;
  decision: "modify_existing" | "new_rule" | "no_rule_change";
  ruleCode: string | null;
  proposedCategory: "aml" | "kyc" | "lending" | "fraud";
  rationale: string;
}

const INSTRUCTION = `
You decide how a bank's transaction monitoring rules must change in response to
each obligation from a circular.

You are given the rules currently in force, described in plain English, and a
numbered list of obligations.

For each obligation choose exactly one:
- "modify_existing" — an existing rule already covers this scenario and its
  parameters must change. Give its rule code. Prefer this whenever an existing
  rule targets the same transaction type and the obligation changes a threshold,
  a scope, or a condition of it.
- "new_rule" — the obligation constrains transactions, but no existing rule
  covers that scenario at all.
- "no_rule_change" — the obligation does not constrain individual transactions.
  Reporting timelines, record retention, staff training, customer communication,
  governance and disclosure requirements all fall here.

A transaction rule can only test these fields of one transaction in isolation:
amount, currency, type, channel, branch, country, customer_id. It cannot count,
aggregate across transactions, look at history, or measure time windows. If an
obligation needs any of those, it is "no_rule_change" — say so in the rationale.

Return exactly one decision per obligation, using its index.
`.trim();

export function createMappingAgent() {
  return defineAgent({
    name: "mapping_agent",
    model: GEMINI_MODEL,
    description:
      "Maps obligations onto existing rules, new rules, or no rule change.",
    instruction: INSTRUCTION,
    outputSchema: mappingOutputSchema,
  });
}

export async function runMappingAgent(
  ctx: PipelineContext,
  params: {
    obligations: StoredObligation[];
    existingRules: ExistingRuleSummary[];
  },
): Promise<MappingDecision[]> {
  const ruleList = params.existingRules
    .map(
      (rule) =>
        `${rule.code} [${rule.category}] ${rule.name}\n    ${rule.explanation}`,
    )
    .join("\n");

  const obligationList = params.obligations
    .map(
      (o, index) =>
        `${index}. (${o.paragraphRef}, ${o.obligationType}) ${o.summary}\n    quote: "${o.quote}"`,
    )
    .join("\n");

  const output = await invokeAgent({
    ctx,
    name: "mapping_agent",
    agent: createMappingAgent(),
    schema: mappingOutputSchema,
    responseType: "finding",
    request: envelope("orchestrator", "mapping_agent", "request", {
      obligation_count: params.obligations.length,
      rule_codes: params.existingRules.map((r) => r.code),
    }),
    parts: [
      {
        text: [
          "RULES CURRENTLY IN FORCE (trusted system state):",
          ruleList || "  (none)",
          "",
          "OBLIGATIONS (derived from an untrusted document):",
          untrustedBlock("obligations", obligationList),
          "",
          "Decide what the rule base needs for each obligation, by index.",
        ].join("\n"),
      },
    ],
  });

  const byCode = new Map(params.existingRules.map((r) => [r.code, r] as const));
  const decisions: MappingDecision[] = [];

  for (const decision of output.decisions) {
    const obligation = params.obligations[decision.obligation_index];
    if (!obligation) continue; // index out of range: ignore rather than guess

    const code = decision.rule_code.trim().toUpperCase();
    const known = byCode.has(code);

    decisions.push({
      obligationId: obligation.obligationId,
      obligationSummary: obligation.summary,
      paragraphRef: obligation.paragraphRef,
      // A modify decision naming a rule we do not have is downgraded rather
      // than trusted: the agent does not get to invent a target.
      decision:
        decision.decision === "modify_existing" && !known
          ? "new_rule"
          : decision.decision,
      ruleCode: decision.decision === "modify_existing" && known ? code : null,
      proposedCategory: decision.proposed_category,
      rationale: decision.rationale.trim(),
    });
  }

  return decisions;
}
