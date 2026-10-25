import { LlmAgent } from "@google/adk";
import { z } from "zod";

import { GEMINI_MODEL } from "@/lib/ai/gemini";

/**
 * Placeholder agent — the first station in the RuleForge pipeline.
 *
 * It reads the text of a regulatory circular and returns the discrete
 * obligations it imposes. Downstream agents (rule drafter, backtester,
 * reviewer) consume this output; none of them exist yet.
 */

/** One obligation lifted out of a circular. */
export const obligationSchema = z.object({
  /** Stable id within the circular, e.g. "OBL-001". */
  id: z.string(),
  /** Clause or paragraph the obligation was taken from, e.g. "para 4.2(b)". */
  citation: z.string(),
  /** The obligation in a single plain sentence. */
  statement: z.string(),
  /** Who the obligation binds, e.g. "scheduled commercial banks". */
  appliesTo: z.string(),
  /** ISO-8601 date the obligation takes effect, if the circular states one. */
  effectiveFrom: z.string().date().nullable(),
  /** How confident the model is that this is a real, binding obligation. */
  confidence: z.number().min(0).max(1),
});

export const obligationExtractionSchema = z.object({
  circularTitle: z.string(),
  obligations: z.array(obligationSchema),
  /** Anything the model could not resolve and a human should look at. */
  openQuestions: z.array(z.string()),
});

export type Obligation = z.infer<typeof obligationSchema>;
export type ObligationExtraction = z.infer<typeof obligationExtractionSchema>;

export const obligationExtractorAgent = new LlmAgent({
  name: "obligation_extractor",
  description:
    "Extracts discrete, citable compliance obligations from the text of a regulatory circular.",
  model: GEMINI_MODEL,
  instruction: [
    "You are a compliance analyst at a bank.",
    "Given the full text of a regulatory circular, list every obligation it places on the institution.",
    "Quote the clause each obligation comes from; never invent a citation.",
    "If a requirement is ambiguous, record it under openQuestions instead of guessing.",
  ].join(" "),
  outputSchema: obligationExtractionSchema,
  outputKey: "obligations",
});
