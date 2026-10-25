/**
 * Obligation agent (MAIN model) — with the anti-hallucination check.
 *
 * The model extracts obligations, each one citing a paragraph and an exact
 * supporting quote. Every quote is then verified **in code** against the text of
 * the paragraph it claims to come from. An obligation whose quote cannot be
 * found is dropped, not repaired: a fabricated citation is the one failure mode
 * that would quietly destroy the audit trail this whole system exists to
 * produce.
 */
import { z } from "zod";

import { GEMINI_MODEL } from "@/lib/ai/gemini";

import { normaliseParagraphRef, type IntakeParagraph } from "./intake-agent";
import {
  defineAgent,
  envelope,
  invokeAgent,
  untrustedBlock,
  type PipelineContext,
} from "./runtime";

export const OBLIGATION_TYPES = [
  "reporting",
  "threshold",
  "kyc",
  "limit",
  "timeline",
  "other",
] as const;

/** A quote shorter than this is not evidence of anything. */
const MIN_QUOTE_LENGTH = 20;

export const obligationOutputSchema = z.object({
  obligations: z
    .array(
      z.object({
        paragraph_ref: z
          .string()
          .describe('The paragraph this obligation comes from, e.g. "Para 3".'),
        quote: z
          .string()
          .describe(
            "An exact, contiguous, word-for-word extract from that paragraph that " +
              "states the obligation. Copy it character for character.",
          ),
        summary: z
          .string()
          .describe("The obligation in one plain sentence."),
        obligation_type: z.enum(OBLIGATION_TYPES),
        deadline: z
          .string()
          .describe('Compliance date as YYYY-MM-DD, or "unknown".'),
      }),
    )
    .describe("Every distinct obligation. Return an empty array if there are none."),
  notes: z
    .string()
    .describe('Anything ambiguous a human should look at, or "none".'),
});

export type ObligationOutput = z.infer<typeof obligationOutputSchema>;

/** An obligation whose quote was found in the paragraph it cites. */
export interface VerifiedObligation {
  paragraphRef: string;
  quote: string;
  summary: string;
  obligationType: (typeof OBLIGATION_TYPES)[number];
  deadline: string | null;
}

export interface ObligationExtraction {
  obligations: VerifiedObligation[];
  /** Dropped obligations, with the reason, for the audit trail. */
  rejected: Array<{ reason: string; obligation: unknown }>;
  notes: string | null;
}

/**
 * Normalises text for quote comparison.
 *
 * A model will faithfully reproduce the words but often not the typography: a
 * PDF's curly quotes, en dashes and non-breaking spaces come back as their
 * ASCII cousins. Those differences are not hallucinations, so they are
 * normalised away before comparing; the words themselves must still match.
 */
export function normaliseForQuoteCheck(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when `quote` really appears in `paragraph`. */
export function quoteAppearsIn(quote: string, paragraph: string): boolean {
  const needle = normaliseForQuoteCheck(quote).replace(/[.,;:]+$/, "");
  if (needle.length < MIN_QUOTE_LENGTH) return false;
  return normaliseForQuoteCheck(paragraph).includes(needle);
}

const INSTRUCTION = `
You are a compliance analyst at a bank, extracting obligations from a circular.

An obligation is something the bank must do, must stop doing, or must do
differently. A statement of background, intent or context is not an obligation.

For each obligation:
- cite the paragraph it comes from;
- supply an EXACT quote from that paragraph, copied word for word, that states
  the obligation. The quote must be a contiguous run of text that appears in the
  paragraph verbatim. Do not stitch together fragments from different sentences,
  do not paraphrase, and do not tidy up the wording. Your quote will be checked
  character by character against the source paragraph and the obligation will be
  discarded if it does not match;
- summarise it in one plain sentence;
- classify it;
- give the compliance date if the circular states one.

Prefer fewer, well-evidenced obligations over many speculative ones. A paragraph
that is purely advisory, or that only recites existing requirements without
changing them, yields no obligation.
`.trim();

export function createObligationAgent() {
  return defineAgent({
    name: "obligation_agent",
    model: GEMINI_MODEL,
    description:
      "Extracts obligations from a circular, each citing a paragraph and an exact quote.",
    instruction: INSTRUCTION,
    outputSchema: obligationOutputSchema,
  });
}

export async function runObligationAgent(
  ctx: PipelineContext,
  params: { paragraphs: IntakeParagraph[]; title: string },
): Promise<ObligationExtraction> {
  const byRef = new Map(
    params.paragraphs.map((p) => [p.paragraphRef, p.text] as const),
  );

  const rendered = params.paragraphs
    .map((p) => `[${p.paragraphRef}] ${p.text}`)
    .join("\n\n");

  const output = await invokeAgent({
    ctx,
    name: "obligation_agent",
    agent: createObligationAgent(),
    schema: obligationOutputSchema,
    responseType: "finding",
    request: envelope("orchestrator", "obligation_agent", "request", {
      title: params.title,
      paragraph_refs: [...byRef.keys()],
    }),
    parts: [
      {
        text: [
          `CIRCULAR TITLE (untrusted): ${params.title}`,
          "",
          untrustedBlock("circular paragraphs", rendered),
          "",
          "Extract the obligations. Quote exactly; your quotes are verified in code.",
        ].join("\n"),
      },
    ],
  });

  const obligations: VerifiedObligation[] = [];
  const rejected: ObligationExtraction["rejected"] = [];

  for (const candidate of output.obligations) {
    const paragraphRef = normaliseParagraphRef(candidate.paragraph_ref);
    const paragraph = byRef.get(paragraphRef);

    if (!paragraph) {
      rejected.push({
        reason: `cites ${paragraphRef}, which is not a paragraph of this circular`,
        obligation: candidate,
      });
      continue;
    }

    if (!quoteAppearsIn(candidate.quote, paragraph)) {
      rejected.push({
        reason:
          candidate.quote.trim().length < MIN_QUOTE_LENGTH
            ? `quote is shorter than ${MIN_QUOTE_LENGTH} characters, which is not usable evidence`
            : `quote was not found verbatim in ${paragraphRef}`,
        obligation: candidate,
      });
      continue;
    }

    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(candidate.deadline.trim())
      ? candidate.deadline.trim()
      : null;

    obligations.push({
      paragraphRef,
      quote: candidate.quote.trim(),
      summary: candidate.summary.trim(),
      obligationType: candidate.obligation_type,
      deadline,
    });
  }

  const notes = output.notes.trim();

  return {
    obligations,
    rejected,
    notes: notes && !/^none$/i.test(notes) ? notes : null,
  };
}
