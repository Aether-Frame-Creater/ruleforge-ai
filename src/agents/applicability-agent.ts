/**
 * Applicability agent (LITE model).
 *
 * Decides whether a circular binds this bank at all, by comparing it against
 * the bank profile. A "no" ends the pipeline: nothing downstream should spend
 * a token on a circular aimed at insurers or co-operative banks.
 */
import { z } from "zod";

import { GEMINI_MODEL_LITE } from "@/lib/ai/gemini";

import { bankProfileForPrompt } from "./bank-profile";
import {
  defineAgent,
  envelope,
  invokeAgent,
  untrustedBlock,
  type PipelineContext,
} from "./runtime";
import type { IntakeResult } from "./intake-agent";

export const applicabilityOutputSchema = z.object({
  applicable: z
    .boolean()
    .describe("True if this circular imposes obligations on the bank described."),
  reason: z
    .string()
    .describe(
      "One or two sentences, citing the paragraph that settles it where possible.",
    ),
  confidence: z.number().min(0).max(1).describe("0 to 1."),
});

export type ApplicabilityResult = z.infer<typeof applicabilityOutputSchema>;

const INSTRUCTION = `
You decide whether a regulatory circular applies to one specific bank.

You are given the bank's profile and the circular's paragraphs. Decide whether
the circular imposes any obligation on this bank.

Judge on:
- the class of institution the circular is addressed to, against the bank's licence type;
- the products and activities it regulates, against the bank's product list;
- the issuing regulator, against the regulators the bank answers to.

Be decisive but honest. If the circular is addressed to a class of institution
this bank does not belong to, it does not apply — say so and cite the paragraph.
If it is addressed broadly to all banks and touches a product the bank offers,
it applies. Lower your confidence when the addressing is ambiguous rather than
inventing certainty.
`.trim();

export function createApplicabilityAgent() {
  return defineAgent({
    name: "applicability_agent",
    model: GEMINI_MODEL_LITE,
    description:
      "Decides whether a circular imposes obligations on the configured bank.",
    instruction: INSTRUCTION,
    outputSchema: applicabilityOutputSchema,
    thinking: "minimal",
  });
}

export async function runApplicabilityAgent(
  ctx: PipelineContext,
  params: { intake: IntakeResult; concurrent?: boolean },
): Promise<ApplicabilityResult> {
  const paragraphs = params.intake.paragraphs
    .map((p) => `[${p.paragraphRef}] ${p.text}`)
    .join("\n\n");

  return invokeAgent({
    ctx,
    name: "applicability_agent",
    agent: createApplicabilityAgent(),
    schema: applicabilityOutputSchema,
    responseType: "finding",
    concurrent: params.concurrent,
    request: envelope("orchestrator", "applicability_agent", "request", {
      title: params.intake.title,
      regulator: params.intake.regulator,
      paragraph_count: params.intake.paragraphs.length,
    }),
    parts: [
      {
        text: [
          "BANK PROFILE (trusted configuration):",
          bankProfileForPrompt(),
          "",
          `CIRCULAR TITLE (from an untrusted document): ${params.intake.title}`,
          `STATED REGULATOR: ${params.intake.regulator}`,
          "",
          untrustedBlock("circular paragraphs", paragraphs),
          "",
          "Does this circular apply to the bank described above?",
        ].join("\n"),
      },
    ],
  });
}
