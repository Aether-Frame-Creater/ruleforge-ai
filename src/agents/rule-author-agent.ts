/**
 * Rule author agent (MAIN model).
 *
 * Writes the json-logic for a mapped obligation. Output is checked against the
 * rule contract (`validateRule`); on failure the errors are handed straight
 * back to the agent and it tries again, up to {@link MAX_AUTHOR_ATTEMPTS}.
 *
 * The same entry point is used when the challenger objects: the objections are
 * fed in as revision notes, so there is exactly one piece of code that is
 * allowed to write a rule, whatever prompted the rewrite.
 *
 * The agent never chooses a status. Drafts are written as `draft` by the
 * orchestrator and only a human can move them on.
 */
import { z } from "zod";

import { GEMINI_MODEL } from "@/lib/ai/gemini";
import { RULE_FIELDS, SAFE_OPERATORS, validateRule } from "@/rules/schema";
import type { RuleLogic } from "@/rules/schema";

import {
  AgentOutputError,
  defineAgent,
  envelope,
  invokeAgent,
  untrustedBlock,
  type PipelineContext,
} from "./runtime";

/** Attempts allowed per authoring call, including the first. */
export const MAX_AUTHOR_ATTEMPTS = 3;

export const ruleAuthorOutputSchema = z.object({
  json_logic: z
    .string()
    .describe(
      "The rule as a compact JSON string, e.g. " +
        '{"and":[{"==":[{"var":"type"},"cash_deposit"]},{">=":[{"var":"amount"},500000]}]}',
    ),
  change_summary: z
    .string()
    .describe("One sentence a reviewer can read, describing what changed and why."),
  reasoning: z
    .string()
    .describe("How the obligation's wording maps onto the rule you wrote."),
});

export type RuleAuthorOutput = z.infer<typeof ruleAuthorOutputSchema>;

export interface AuthoredRule {
  jsonLogic: RuleLogic;
  changeSummary: string;
  reasoning: string;
  /** How many model calls it took to produce a contract-valid rule. */
  attempts: number;
}

/** One obligation the rule has to satisfy. */
export interface AuthorObligation {
  summary: string;
  paragraphRef: string;
  /** The exact source paragraph, so the author works from primary text. */
  paragraphText: string;
  quote: string;
}

export interface RuleAuthorRequest {
  /**
   * Every obligation this one rule version must satisfy.
   *
   * More than one obligation can bear on the same rule. They are authored
   * together so the result satisfies all of them at once: drafting them
   * separately produced independent versions baselined on the same parent, and
   * the later draft silently reverted the earlier one.
   */
  obligations: AuthorObligation[];
  /** The rule being modified, if any. */
  target?: {
    code: string;
    name: string;
    explanation: string;
    currentJsonLogic: unknown;
  };
  /** Challenger objections from a previous round, if this is a revision. */
  objections?: string[];
  /** Marks the call as concurrent, for the timing table. */
  concurrent?: boolean;
}

const CONTRACT_BRIEF = `
A rule is a json-logic expression. The ONLY operators permitted are:
${SAFE_OPERATORS.join(", ")}

The ONLY transaction fields a rule may read are:
${RULE_FIELDS.join(", ")}

Field semantics:
- amount: a number, the transaction value in the transaction's currency.
- currency: ISO code string, e.g. "INR".
- type: one of cash_deposit, cash_withdrawal, transfer, upi, card, loan_disbursal.
- channel: one of branch, atm, mobile, internet.
- branch: branch name string, may be absent.
- country: ISO-2 counterparty country, e.g. "IN".
- customer_id: opaque string.

Hard constraints:
- Reference a field only as {"var":"amount"} — never with a fallback value.
- "in" takes a list of literals: {"in":[{"var":"country"},["AE","US"]]}. Never a string.
- The rule must evaluate to true for exactly the transactions that should be flagged.
- A rule sees ONE transaction at a time. It cannot count, sum, aggregate, compare
  against history, or reason about time windows.
- Amounts are plain numbers with no separators: write 500000, not 5,00,000 or "5 lakh".
`.trim();

const INSTRUCTION = `
You write transaction monitoring rules for a bank, as json-logic.

${CONTRACT_BRIEF}

Write the smallest rule that implements the obligation faithfully. Keep the
scope of the rule you are modifying unless the obligation actually changes it:
if only a threshold moves, change only the threshold and leave every other
condition exactly as it was.

If you are given validation errors or reviewer objections, fix precisely those
problems and change nothing else.

You are drafting for human approval. You have no authority to approve, deploy,
or activate anything, and nothing you write takes effect until a person signs it
off. Do not describe the rule as approved or live.
`.trim();

export function createRuleAuthorAgent() {
  return defineAgent({
    name: "rule_author_agent",
    model: GEMINI_MODEL,
    description: "Writes json-logic rules that satisfy a mapped obligation.",
    instruction: INSTRUCTION,
    outputSchema: ruleAuthorOutputSchema,
    thinking: "low",
  });
}

function buildPrompt(
  request: RuleAuthorRequest,
  validationErrors: string[],
  previousAttempt: string | null,
): string {
  const lines: string[] = [];

  if (request.target) {
    lines.push(
      "RULE BEING MODIFIED (trusted system state):",
      `  code: ${request.target.code}`,
      `  name: ${request.target.name}`,
      `  current behaviour: ${request.target.explanation}`,
      `  current json_logic: ${JSON.stringify(request.target.currentJsonLogic)}`,
      "",
    );
  } else {
    lines.push("NEW RULE: there is no existing rule for this scenario.", "");
  }

  lines.push(
    request.obligations.length > 1
      ? `OBLIGATIONS (${request.obligations.length}, all of which this one rule must satisfy):`
      : "OBLIGATION (derived from an untrusted document):",
    "",
  );

  for (const obligation of request.obligations) {
    lines.push(
      `  ${obligation.paragraphRef}: ${obligation.summary}`,
      untrustedBlock(
        `${obligation.paragraphRef} (source text)`,
        obligation.paragraphText,
      ),
      `  VERIFIED QUOTE: "${obligation.quote}"`,
      "",
    );
  }

  if (request.objections?.length) {
    lines.push(
      "A reviewing agent rejected your previous draft. Fix exactly these objections:",
      ...request.objections.map((o) => `  - ${o}`),
      "",
    );
  }

  if (validationErrors.length) {
    lines.push(
      "Your previous attempt FAILED the rule contract:",
      previousAttempt ? `  attempted: ${previousAttempt}` : "",
      ...validationErrors.map((e) => `  - ${e}`),
      "",
      "Return a corrected rule that satisfies every constraint.",
      "",
    );
  }

  lines.push("Write the json_logic for this obligation.");
  return lines.filter((line) => line !== "").join("\n");
}

/**
 * Authors a rule, retrying with the contract's own error messages until it is
 * valid or the attempt budget runs out.
 */
export async function runRuleAuthorAgent(
  ctx: PipelineContext,
  request: RuleAuthorRequest,
): Promise<AuthoredRule> {
  const agent = createRuleAuthorAgent();
  let validationErrors: string[] = [];
  let previousAttempt: string | null = null;
  let lastFailure = "";

  for (let attempt = 1; attempt <= MAX_AUTHOR_ATTEMPTS; attempt += 1) {
    // Annotated explicitly: `previousAttempt` is both an input to this call and
    // assigned from its result, which leaves inference chasing its own tail.
    const output: RuleAuthorOutput = await invokeAgent({
      ctx,
      name: "rule_author_agent",
      agent,
      schema: ruleAuthorOutputSchema,
      concurrent: request.concurrent,
      request: envelope("orchestrator", "rule_author_agent", "request", {
        paragraph_refs: request.obligations.map((o) => o.paragraphRef),
        target_rule: request.target?.code ?? null,
        attempt,
        validation_errors: validationErrors,
        objections: request.objections ?? [],
      }),
      parts: [
        { text: buildPrompt(request, validationErrors, previousAttempt) },
      ],
    });

    previousAttempt = output.json_logic;

    let parsed: unknown;
    try {
      parsed = JSON.parse(output.json_logic);
    } catch {
      validationErrors = [
        `json_logic was not parseable JSON: ${output.json_logic.slice(0, 160)}`,
      ];
      lastFailure = validationErrors[0];
      continue;
    }

    const result = validateRule(parsed);
    if (result.ok) {
      return {
        jsonLogic: parsed as RuleLogic,
        changeSummary: output.change_summary.trim(),
        reasoning: output.reasoning.trim(),
        attempts: attempt,
      };
    }

    validationErrors = result.errors;
    lastFailure = result.errors.join("; ");
  }

  throw new AgentOutputError(
    "rule_author_agent",
    `no contract-valid rule after ${MAX_AUTHOR_ATTEMPTS} attempts: ${lastFailure}`,
  );
}
