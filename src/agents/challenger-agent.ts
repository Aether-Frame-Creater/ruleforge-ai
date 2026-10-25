/**
 * Challenger agent (MAIN model) — the independent reviewer.
 *
 * Deliberately adversarial and deliberately uninformed about how the draft was
 * produced: it is shown the source paragraph and the resulting rule, and
 * nothing about the author's reasoning. Checking a draft against the author's
 * own justification would only confirm the author's mistakes.
 *
 * Its objections are fed back to the rule author by the orchestrator, for at
 * most two rounds; a draft that still fails is kept and flagged for a human.
 */
import { z } from "zod";

import { GEMINI_MODEL } from "@/lib/ai/gemini";
import { explainRule } from "@/rules/engine";
import type { RuleLogic } from "@/rules/schema";

import type { AuthorObligation } from "./rule-author-agent";

import {
  defineAgent,
  envelope,
  invokeAgent,
  untrustedBlock,
  type PipelineContext,
} from "./runtime";

export const challengerOutputSchema = z.object({
  verdict: z
    .enum(["pass", "fail"])
    .describe("fail if the rule does not faithfully implement the paragraph."),
  reasons: z
    .array(z.string())
    .describe(
      "For a fail, one concrete, actionable objection per entry. For a pass, " +
        "the checks you performed.",
    ),
  severity: z
    .enum(["none", "minor", "material"])
    .describe("How badly wrong the draft is."),
});

export type ChallengerVerdict = z.infer<typeof challengerOutputSchema>;

const INSTRUCTION = `
You are an independent reviewer in a bank's model risk function. A colleague has
drafted a transaction monitoring rule from a regulatory paragraph. Your job is to
find out whether it is wrong. You did not write it and you owe it no loyalty.

Check, in this order:
1. THRESHOLD — is every numeric value exactly the figure the paragraph states?
   Watch for Indian numbering: "5,00,000" and "five lakh" both mean 500000;
   "10,00,000" and "ten lakh" mean 1000000. A rule using 5000000 for "five lakh"
   is wrong by a factor of ten.
2. COMPARISON — does "or more" mean >=, "more than" mean >, "below" mean <?
   An off-by-one on the boundary is a real defect.
3. SCOPE — does the rule match the transaction types, channels, currencies and
   countries the paragraph covers: no wider, no narrower? A rule that drops a
   condition the previous version had has silently widened its scope.
4. MISSING CONDITIONS — does the paragraph qualify the obligation in a way the
   rule ignores?
5. OVERREACH — does the rule flag transactions the paragraph says nothing about?

Fail the draft if any check fails. Each objection must say what is wrong and what
it should be, specifically enough for the author to act on it without guessing.

Pass it only if you would sign your name under it. Do not fail a draft for style,
for conditions the rule contract cannot express, or because you would have
written it differently. If the paragraph imposes a requirement that no
single-transaction rule could express, that is not the draft's fault.
`.trim();

export function createChallengerAgent() {
  return defineAgent({
    name: "challenger_agent",
    model: GEMINI_MODEL,
    description:
      "Independently reviews a drafted rule against its source paragraph.",
    instruction: INSTRUCTION,
    outputSchema: challengerOutputSchema,
    // The adversarial check is where deliberation actually pays.
    thinking: "low",
  });
}

export async function runChallengerAgent(
  ctx: PipelineContext,
  params: {
    ruleCode: string;
    /** Every obligation the draft is supposed to satisfy. */
    obligations: AuthorObligation[];
    draftJsonLogic: RuleLogic;
    previousJsonLogic?: unknown;
    previousExplanation?: string;
    round: number;
    concurrent?: boolean;
  },
): Promise<ChallengerVerdict> {
  return invokeAgent({
    ctx,
    name: "challenger_agent",
    agent: createChallengerAgent(),
    schema: challengerOutputSchema,
    concurrent: params.concurrent,
    // An objection is a rejection. A passing review is a result, and
    // labelling it otherwise made the audit trail read as if every draft
    // had been objected to.
    responseType: (verdict) =>
      verdict.verdict === "fail" ? "objection" : "result",
    request: envelope("orchestrator", "challenger_agent", "request", {
      rule_code: params.ruleCode,
      paragraph_refs: params.obligations.map((o) => o.paragraphRef),
      round: params.round,
    }),
    parts: [
      {
        text: [
          `RULE UNDER REVIEW: ${params.ruleCode}`,
          "",
          params.obligations.length > 1
            ? `The draft must satisfy all ${params.obligations.length} of these paragraphs.`
            : "SOURCE PARAGRAPH (untrusted document, this is the authority):",
          "",
          ...params.obligations.flatMap((obligation) => [
            untrustedBlock(obligation.paragraphRef, obligation.paragraphText),
            `VERIFIED QUOTE: "${obligation.quote}"`,
            `OBLIGATION AS RECORDED: ${obligation.summary}`,
            "",
          ]),
          params.previousJsonLogic
            ? [
                "RULE CURRENTLY IN FORCE (what the draft would replace):",
                `  json_logic: ${JSON.stringify(params.previousJsonLogic)}`,
                `  behaviour:  ${params.previousExplanation ?? "(not available)"}`,
                "",
              ].join("\n")
            : "There is no rule in force for this scenario; the draft is new.\n",
          "DRAFT UNDER REVIEW:",
          `  json_logic: ${JSON.stringify(params.draftJsonLogic)}`,
          `  behaviour:  ${explainRule(params.draftJsonLogic)}`,
          "",
          "Does this draft faithfully implement the paragraph? Check the threshold first.",
        ].join("\n"),
      },
    ],
  });
}
