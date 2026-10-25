/**
 * Shared types for the circular pipeline: the case file the agents work on,
 * and the message envelopes they exchange.
 */
import type { ApplicabilityResult } from "./applicability-agent";
import type { ChallengerVerdict } from "./challenger-agent";
import type { ImpactAssessment } from "./impact-agent";
import type { IntakeResult } from "./intake-agent";
import type { MappingDecision } from "./mapping-agent";
import type { VerifiedObligation } from "./obligation-agent";
import type { BacktestSummary } from "@/rules/backtest";
import type { CallTiming } from "./runtime";

/** Who can send or receive an envelope. */
export type AgentName =
  | "orchestrator"
  | "intake_agent"
  | "applicability_agent"
  | "obligation_agent"
  | "mapping_agent"
  | "rule_author_agent"
  | "backtest_tool"
  | "impact_agent"
  | "challenger_agent";

/**
 * An A2A-style message envelope.
 *
 * Deliberately the same shape the A2A protocol uses for agent-to-agent
 * messages, so moving an agent out of process later is a transport change
 * rather than a redesign. Every envelope is persisted on the `agent_runs` row
 * for the call it belongs to.
 */
export interface A2AEnvelope<TPayload = unknown> {
  from: AgentName;
  to: AgentName;
  type: "finding" | "objection" | "request" | "result";
  payload: TPayload;
  /** ISO-8601. */
  timestamp: string;
}

/** A paragraph of the circular as stored in `circular_chunks`. */
export interface StoredChunk {
  chunkId: string;
  paragraphRef: string;
  text: string;
  embedded: boolean;
}

/** An obligation after it has been written to the database. */
export interface StoredObligation extends VerifiedObligation {
  obligationId: string;
  chunkId: string | null;
}

/** A draft rule version produced for one mapped obligation. */
export interface DraftRecord {
  obligationId: string;
  ruleId: string;
  ruleCode: string;
  ruleVersionId: string;
  version: number;
  jsonLogic: unknown;
  explanation: string;
  /** What changed against the version in force, in reviewer-facing terms. */
  diff: string[];
  baselineVersionId: string | null;
  attempts: number;
  backtest?: BacktestSummary;
  impact?: ImpactAssessment;
  challenger?: ChallengerVerdict;
  /** Set when the challenger never passed it; a human has to look. */
  needsHumanAttention: boolean;
  attentionReason?: string;
}

/**
 * The blackboard. Each stage reads what earlier stages wrote and adds its own
 * result; nothing is mutated in place behind another stage's back.
 */
export interface CaseFile {
  circularId: string;
  pdfPath: string;
  intake?: IntakeResult;
  chunks: StoredChunk[];
  applicability?: ApplicabilityResult;
  obligations: StoredObligation[];
  /** Obligations the quote check rejected, kept for the audit trail. */
  rejectedObligations: Array<{ reason: string; obligation: unknown }>;
  mappings: MappingDecision[];
  drafts: DraftRecord[];
  envelopes: A2AEnvelope[];
}

export type PipelineOutcome =
  | "not_applicable"
  | "no_obligations"
  | "no_rule_changes"
  | "review";

export interface PipelineResult {
  outcome: PipelineOutcome;
  /** Why the pipeline stopped where it did. */
  reason: string;
  caseFile: CaseFile;
  stats: {
    llmCalls: number;
    /** Calls that actually reached the API. Zero in replay mode. */
    apiCalls: number;
    replayedCalls: number;
    fallbackCalls: number;
    promptTokens: number;
    candidateTokens: number;
    thoughtTokens: number;
    totalTokens: number;
    elapsedMs: number;
    retries: number;
    retryCounts: { rateLimited: number; unavailable: number; other: number };
  };
  /** Per-call timings, in completion order. */
  timings: CallTiming[];
}
