/**
 * The pipeline orchestrator.
 *
 * Plain TypeScript, deliberately: the control flow of a compliance pipeline is
 * exactly the thing that should not be improvised by a language model. Each
 * agent is a step whose output is validated before the next step runs, and the
 * routing between them is ordinary code that can be read, tested and reasoned
 * about.
 *
 * The one invariant that matters most: **no agent can approve anything.** The
 * only `rule_versions.status` this file ever writes is `draft`, and the only
 * `circulars.status` it writes are `analysing`, `not_applicable` and `review`.
 * Moving a rule to approved, shadow or live is a human action that happens
 * nowhere in this code path.
 */
import { desc, eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";

import {
  circulars,
  obligations as obligationsTable,
  rules,
  ruleVersions,
} from "@/db/schema";
import { db } from "@/lib/db";
import { runBacktest } from "@/rules/backtest";
import { diffRules, explainRule } from "@/rules/engine";
import type { RuleLogic } from "@/rules/schema";

import { runApplicabilityAgent } from "./applicability-agent";
import { runChallengerAgent } from "./challenger-agent";
import { storeCircularChunks } from "./embeddings";
import { runImpactAgent } from "./impact-agent";
import { runIntakeAgent } from "./intake-agent";
import {
  runMappingAgent,
  type ExistingRuleSummary,
  type MappingDecision,
} from "./mapping-agent";
import { runObligationAgent } from "./obligation-agent";
import {
  runRuleAuthorAgent,
  type AuthorObligation,
} from "./rule-author-agent";
import {
  audit,
  envelope,
  recordToolRun,
  DEFAULT_BUDGET,
  PipelineContext,
  type PipelineBudget,
} from "./runtime";
import type {
  CaseFile,
  DraftRecord,
  PipelineResult,
  StoredObligation,
} from "./types";

/**
 * How many times the challenger may review a draft for one obligation.
 * Round 1 reviews the first draft; a failure buys one revision, which round 2
 * reviews. A draft still failing after that is kept and escalated to a human.
 */
export const MAX_CHALLENGER_ROUNDS = 2;

/** The only status this pipeline is permitted to give a rule version. */
const AGENT_WRITABLE_STATUS = "draft" as const;

const ACTOR = "agent:orchestrator";

export interface RunPipelineOptions {
  budget?: PipelineBudget;
  /** Called with progress lines so a CLI can show the run as it happens. */
  onProgress?: (message: string) => void;
}

async function setCircularStatus(
  circularId: string,
  status: "analysing" | "not_applicable" | "review",
  extra: { applicabilityReason?: string } = {},
): Promise<void> {
  await db
    .update(circulars)
    .set({ status, ...extra })
    .where(eq(circulars.id, circularId));

  await audit({
    actor: ACTOR,
    action: "circular.status_changed",
    entityType: "circulars",
    entityId: circularId,
    details: { status, ...extra },
  });
}

/** Loads the live rules with a plain-English rendering of each. */
async function loadExistingRules(): Promise<ExistingRuleSummary[]> {
  const rows = await db
    .select({
      ruleId: rules.id,
      code: rules.code,
      name: rules.name,
      category: rules.category,
      currentVersionId: rules.currentVersionId,
      jsonLogic: ruleVersions.jsonLogic,
      version: ruleVersions.version,
    })
    .from(rules)
    .leftJoin(ruleVersions, eq(ruleVersions.id, rules.currentVersionId))
    .orderBy(rules.code);

  return rows.map((row) => ({
    ruleId: row.ruleId,
    code: row.code,
    name: row.name,
    category: row.category,
    currentVersionId: row.currentVersionId,
    currentVersion: row.version ?? null,
    explanation: row.jsonLogic
      ? safeExplain(row.jsonLogic)
      : "(no version in force)",
  }));
}

/** `explainRule` throws on a rule that breaks the contract; never fail a read. */
function safeExplain(logic: unknown): string {
  try {
    return explainRule(logic);
  } catch (error) {
    return `(cannot be explained: ${error instanceof Error ? error.message : "invalid"})`;
  }
}

/** Next free code in the R-nnn series. */
async function nextRuleCode(): Promise<string> {
  const existing = await db.select({ code: rules.code }).from(rules);
  const highest = existing.reduce((max, { code }) => {
    const match = code.match(/^R-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 100);
  return `R-${highest + 1}`;
}

async function nextVersionNumber(ruleId: string): Promise<number> {
  const [latest] = await db
    .select({ version: ruleVersions.version })
    .from(ruleVersions)
    .where(eq(ruleVersions.ruleId, ruleId))
    .orderBy(desc(ruleVersions.version))
    .limit(1);
  return (latest?.version ?? 0) + 1;
}

/**
 * Runs the whole pipeline for one circular.
 *
 * Returns the case file and the outcome; it does not throw for a business
 * outcome ("not applicable" is a result, not an error). It does throw if the
 * run breaches its budget or an agent fails irrecoverably, so the caller can
 * record a failed run.
 */
export async function runCircularPipeline(
  circularId: string,
  options: RunPipelineOptions = {},
): Promise<PipelineResult> {
  const ctx = new PipelineContext(circularId, options.budget ?? DEFAULT_BUDGET);
  const progress = options.onProgress ?? (() => {});

  const [circular] = await db
    .select({ id: circulars.id, pdfUrl: circulars.pdfUrl, title: circulars.title })
    .from(circulars)
    .where(eq(circulars.id, circularId))
    .limit(1);

  if (!circular) throw new Error(`circular ${circularId} does not exist`);

  const caseFile: CaseFile = {
    circularId,
    pdfPath: circular.pdfUrl,
    chunks: [],
    obligations: [],
    rejectedObligations: [],
    mappings: [],
    drafts: [],
    envelopes: ctx.envelopes,
  };

  const finish = (
    outcome: PipelineResult["outcome"],
    reason: string,
  ): PipelineResult => ({
    outcome,
    reason,
    caseFile,
    stats: ctx.stats(),
    timings: ctx.timings,
  });

  await setCircularStatus(circularId, "analysing");

  /* -- 1. intake ---------------------------------------------------------- */

  progress("intake_agent: reading the PDF");
  const pdf = await readFile(circular.pdfUrl);
  const intake = await runIntakeAgent(ctx, {
    pdf,
    fileName: circular.pdfUrl,
  });
  caseFile.intake = intake;
  progress(
    `intake_agent: "${intake.title}" (${intake.paragraphs.length} paragraphs)`,
  );

  /* -- 2 and 3. embeddings, metadata and applicability, concurrently ------ */

  // These three touch nothing of each other's: storing paragraphs is a write,
  // the metadata update is a write to a different table, and the applicability
  // check only reads the intake result already in memory. The paragraphs are
  // stored even if the circular turns out not to apply — the record of what we
  // read is worth keeping either way.
  progress("embeddings + applicability_agent: running concurrently");
  const [stored, applicability] = await Promise.all([
    storeCircularChunks({ circularId, paragraphs: intake.paragraphs }),
    runApplicabilityAgent(ctx, { intake, concurrent: true }),
    db
      .update(circulars)
      .set({
        title: intake.title,
        regulator: intake.regulator,
        circularNumber: intake.circularNumber,
        issuedDate: intake.issuedDate,
      })
      .where(eq(circulars.id, circularId)),
  ]);

  caseFile.chunks = stored.chunks;
  progress(
    `embeddings: ${stored.chunks.length} chunks stored, ${stored.embedded} embedded` +
      (stored.failed ? `, ${stored.failed} without a vector` : ""),
  );

  const chunkByRef = new Map(
    stored.chunks.map((chunk) => [chunk.paragraphRef, chunk] as const),
  );

  caseFile.applicability = applicability;
  progress(
    `applicability_agent: ${applicability.applicable ? "applies" : "does not apply"} ` +
      `(confidence ${applicability.confidence})`,
  );

  if (!applicability.applicable) {
    await setCircularStatus(circularId, "not_applicable", {
      applicabilityReason: applicability.reason,
    });
    return finish("not_applicable", applicability.reason);
  }

  await db
    .update(circulars)
    .set({ applicabilityReason: applicability.reason })
    .where(eq(circulars.id, circularId));

  /* -- 4. obligations ----------------------------------------------------- */

  progress("obligation_agent: extracting obligations");
  const extraction = await runObligationAgent(ctx, {
    paragraphs: intake.paragraphs,
    title: intake.title,
  });
  caseFile.rejectedObligations = extraction.rejected;

  for (const dropped of extraction.rejected) {
    progress(`obligation_agent: DROPPED an obligation — ${dropped.reason}`);
    await audit({
      actor: "agent:obligation_agent",
      action: "obligation.rejected_unverifiable_quote",
      entityType: "circulars",
      entityId: circularId,
      details: dropped,
    });
  }

  if (extraction.obligations.length === 0) {
    const reason =
      "the circular applies, but no obligation survived the quote verification check";
    await setCircularStatus(circularId, "review");
    await audit({
      actor: ACTOR,
      action: "pipeline.stopped",
      entityType: "circulars",
      entityId: circularId,
      details: { reason, rejected: extraction.rejected.length },
    });
    return finish("no_obligations", reason);
  }

  const storedObligations: StoredObligation[] = [];
  for (const obligation of extraction.obligations) {
    const chunk = chunkByRef.get(obligation.paragraphRef) ?? null;
    const [row] = await db
      .insert(obligationsTable)
      .values({
        circularId,
        chunkId: chunk?.chunkId ?? null,
        summary: obligation.summary,
        obligationType: obligation.obligationType,
        deadline: obligation.deadline,
        status: "extracted",
      })
      .returning({ id: obligationsTable.id });

    storedObligations.push({
      ...obligation,
      obligationId: row.id,
      chunkId: chunk?.chunkId ?? null,
    });

    await audit({
      actor: "agent:obligation_agent",
      action: "obligation.extracted",
      entityType: "obligations",
      entityId: row.id,
      details: {
        circular_id: circularId,
        paragraph_ref: obligation.paragraphRef,
        chunk_id: chunk?.chunkId ?? null,
        quote: obligation.quote,
      },
    });
  }
  caseFile.obligations = storedObligations;
  progress(
    `obligation_agent: ${storedObligations.length} verified, ${extraction.rejected.length} dropped`,
  );

  /* -- 5. mapping --------------------------------------------------------- */

  const existingRules = await loadExistingRules();
  progress("mapping_agent: deciding what the rule base needs");
  const mappings = await runMappingAgent(ctx, {
    obligations: storedObligations,
    existingRules,
  });
  caseFile.mappings = mappings;

  for (const mapping of mappings) {
    progress(
      `mapping_agent: ${mapping.paragraphRef} -> ${mapping.decision}` +
        (mapping.ruleCode ? ` (${mapping.ruleCode})` : ""),
    );
  }

  const actionable = mappings.filter(
    (m) => m.decision === "modify_existing" || m.decision === "new_rule",
  );

  if (actionable.length === 0) {
    const reason =
      "every obligation was a process requirement that no transaction rule can express";
    await setCircularStatus(circularId, "review");
    await audit({
      actor: ACTOR,
      action: "pipeline.stopped",
      entityType: "circulars",
      entityId: circularId,
      details: { reason, obligations: storedObligations.length },
    });
    return finish("no_rule_changes", reason);
  }

  /* -- 6. author, backtest, impact, challenge ----------------------------- */

  const obligationById = new Map(
    storedObligations.map((o) => [o.obligationId, o] as const),
  );
  const ruleByCode = new Map(existingRules.map((r) => [r.code, r] as const));

  /** One rule and every obligation that bears on it. */
  interface DraftGroup {
    ruleCode: string | null;
    category: MappingDecision["proposedCategory"];
    mappings: MappingDecision[];
  }

  // Group by target rule. More than one obligation can land on the same rule,
  // and drafting each one separately produced independent versions baselined on
  // the same parent — the later draft silently reverted the earlier one's
  // change. One rule gets one draft that satisfies all of its obligations.
  const groups: DraftGroup[] = [];
  const groupByCode = new Map<string, DraftGroup>();

  for (const mapping of actionable) {
    if (mapping.decision === "modify_existing" && mapping.ruleCode) {
      const existing = groupByCode.get(mapping.ruleCode);
      if (existing) {
        existing.mappings.push(mapping);
        continue;
      }
      const group: DraftGroup = {
        ruleCode: mapping.ruleCode,
        category: mapping.proposedCategory,
        mappings: [mapping],
      };
      groupByCode.set(mapping.ruleCode, group);
      groups.push(group);
    } else {
      // Two unrelated new rules stay separate; there is nothing to merge.
      groups.push({
        ruleCode: null,
        category: mapping.proposedCategory,
        mappings: [mapping],
      });
    }
  }

  const obligationsFor = (group: DraftGroup): AuthorObligation[] =>
    group.mappings
      .map((mapping) => obligationById.get(mapping.obligationId))
      .filter((o): o is StoredObligation => o !== undefined)
      .map((obligation) => ({
        summary: obligation.summary,
        paragraphRef: obligation.paragraphRef,
        paragraphText:
          chunkByRef.get(obligation.paragraphRef)?.text ?? obligation.quote,
        quote: obligation.quote,
      }));

  // New rules are created before the concurrent phase: `nextRuleCode` reads the
  // highest code in the table, so two creations racing would claim the same one.
  const prepared: Array<{ group: DraftGroup; target: ExistingRuleSummary }> = [];
  for (const group of groups) {
    const obligations = obligationsFor(group);
    if (obligations.length === 0) continue;

    let target = group.ruleCode ? ruleByCode.get(group.ruleCode) : undefined;
    if (!target) {
      const code = await nextRuleCode();
      const name = obligations[0].summary.slice(0, 80);
      const [created] = await db
        .insert(rules)
        .values({
          code,
          name,
          description: `Created from ${obligations[0].paragraphRef} of "${intake.title}".`,
          category: group.category,
        })
        .returning({ id: rules.id, code: rules.code });

      target = {
        ruleId: created.id,
        code: created.code,
        name,
        category: group.category,
        explanation: "(no version in force)",
        currentVersionId: null,
        currentVersion: null,
      };
      ruleByCode.set(code, target);

      await audit({
        actor: ACTOR,
        action: "rule.created",
        entityType: "rules",
        entityId: created.id,
        details: {
          code,
          from_obligations: group.mappings.map((m) => m.obligationId),
        },
      });
      progress(`rule_author_agent: created new rule ${code}`);
    }

    prepared.push({ group, target });
  }

  /**
   * Drafts one rule: author, backtest, impact, challenge, and revise if the
   * challenger objects. Sequential within a rule — each round depends on the
   * last — but independent of every other rule.
   */
  async function draftRule(
    group: DraftGroup,
    target: ExistingRuleSummary,
    concurrent: boolean,
  ): Promise<DraftRecord | undefined> {
    const obligations = obligationsFor(group);
    const primary = group.mappings[0];
    const refs = obligations.map((o) => o.paragraphRef).join(", ");

    const baselineVersionId = target.currentVersionId;
    const baselineLogic = baselineVersionId
      ? (
          await db
            .select({ jsonLogic: ruleVersions.jsonLogic })
            .from(ruleVersions)
            .where(eq(ruleVersions.id, baselineVersionId))
            .limit(1)
        )[0]?.jsonLogic
      : undefined;

    let objections: string[] | undefined;
    let draft: DraftRecord | undefined;

    for (let round = 1; round <= MAX_CHALLENGER_ROUNDS; round += 1) {
      progress(
        `rule_author_agent: drafting for ${target.code} (${refs}, round ${round})`,
      );

      const authored = await runRuleAuthorAgent(ctx, {
        obligations,
        target: baselineLogic
          ? {
              code: target.code,
              name: target.name,
              explanation: target.explanation,
              currentJsonLogic: baselineLogic,
            }
          : undefined,
        objections,
        concurrent,
      });

      const version = await nextVersionNumber(target.ruleId);
      const [versionRow] = await db
        .insert(ruleVersions)
        .values({
          ruleId: target.ruleId,
          version,
          jsonLogic: authored.jsonLogic as never,
          // One column, so the first obligation is the link; the audit entry
          // below records every obligation the draft answers.
          obligationId: primary.obligationId,
          // Never anything but draft. A human promotes it, or nobody does.
          status: AGENT_WRITABLE_STATUS,
          changeSummary: authored.changeSummary,
          createdByAgent: "rule_author_agent",
        })
        .returning({ id: ruleVersions.id });

      await audit({
        actor: "agent:rule_author_agent",
        action: "rule_version.drafted",
        entityType: "rule_versions",
        entityId: versionRow.id,
        details: {
          rule_code: target.code,
          version,
          status: AGENT_WRITABLE_STATUS,
          obligation_ids: group.mappings.map((m) => m.obligationId),
          paragraph_refs: obligations.map((o) => o.paragraphRef),
          attempts: authored.attempts,
          round,
        },
      });

      const diff = baselineLogic
        ? diffRules(baselineLogic, authored.jsonLogic).map((d) => d.message)
        : ["new rule, nothing to compare against"];

      draft = {
        obligationId: primary.obligationId,
        ruleId: target.ruleId,
        ruleCode: target.code,
        ruleVersionId: versionRow.id,
        version,
        jsonLogic: authored.jsonLogic,
        explanation: explainRule(authored.jsonLogic),
        diff,
        baselineVersionId,
        attempts: authored.attempts,
        needsHumanAttention: false,
      };

      /* -- backtest: a tool, not an agent -------------------------------- */

      progress(`backtest_tool: replaying ${target.code} v${version}`);
      const backtest = await recordToolRun({
        ctx,
        name: "backtest_tool",
        concurrent,
        request: envelope("orchestrator", "backtest_tool", "request", {
          candidate_version_id: versionRow.id,
          baseline_version_id: baselineVersionId,
        }),
        run: () =>
          runBacktest({
            candidateVersionId: versionRow.id,
            baselineVersionId,
            actor: "agent:orchestrator",
          }),
      });
      draft.backtest = backtest;
      progress(
        `backtest_tool: ${target.code} ${backtest.old_alerts} -> ${backtest.new_alerts} alerts ` +
          `(+${backtest.alerts_added}/-${backtest.alerts_removed}), ` +
          `${backtest.customers_affected} customers`,
      );

      /* -- impact and challenge, concurrently ---------------------------- */

      // The impact summary reads the backtest numbers; the challenger reads the
      // paragraph and the draft. Neither needs the other's answer.
      progress(`impact_agent + challenger_agent: reviewing ${target.code} v${version}`);
      const [impact, verdict] = await Promise.all([
        runImpactAgent(ctx, {
          ruleCode: target.code,
          backtest,
          changeSummary: authored.changeSummary,
          concurrent: true,
        }),
        runChallengerAgent(ctx, {
          ruleCode: target.code,
          obligations,
          draftJsonLogic: authored.jsonLogic as RuleLogic,
          previousJsonLogic: baselineLogic,
          previousExplanation: baselineLogic ? target.explanation : undefined,
          round,
          concurrent: true,
        }),
      ]);

      draft.impact = impact;
      draft.challenger = verdict;
      progress(`impact_agent: ${target.code} risk ${impact.risk_level}`);
      progress(`challenger_agent: ${target.code} ${verdict.verdict} (${verdict.severity})`);

      await audit({
        actor: "agent:challenger_agent",
        action: `rule_version.challenge_${verdict.verdict}`,
        entityType: "rule_versions",
        entityId: versionRow.id,
        details: { round, severity: verdict.severity, reasons: verdict.reasons },
      });

      if (verdict.verdict === "pass") break;

      objections = verdict.reasons;

      if (round === MAX_CHALLENGER_ROUNDS) {
        draft.needsHumanAttention = true;
        draft.attentionReason = `the challenger still objects after ${MAX_CHALLENGER_ROUNDS} rounds: ${verdict.reasons.join("; ")}`;
        progress(
          `challenger_agent: ${target.code} kept as a draft and flagged for human attention`,
        );
        await audit({
          actor: ACTOR,
          action: "rule_version.flagged_for_human",
          entityType: "rule_versions",
          entityId: versionRow.id,
          details: { reasons: verdict.reasons },
        });
      }
    }

    return draft;
  }

  // Different rules share nothing: no version counter, no baseline, no agent
  // state. One slow rule no longer holds up the others.
  const concurrentDrafts = prepared.length > 1;
  const results = await Promise.all(
    prepared.map(({ group, target }) =>
      draftRule(group, target, concurrentDrafts),
    ),
  );
  for (const draft of results) {
    if (draft) caseFile.drafts.push(draft);
  }

  /* -- 7. hand over to a human ------------------------------------------- */

  await setCircularStatus(circularId, "review");
  await audit({
    actor: ACTOR,
    action: "pipeline.completed",
    entityType: "circulars",
    entityId: circularId,
    details: {
      drafts: caseFile.drafts.map((d) => ({
        rule_code: d.ruleCode,
        version: d.version,
        rule_version_id: d.ruleVersionId,
        status: AGENT_WRITABLE_STATUS,
        challenger: d.challenger?.verdict,
        needs_human_attention: d.needsHumanAttention,
      })),
      stats: ctx.stats(),
    },
  });

  const flagged = caseFile.drafts.filter((d) => d.needsHumanAttention).length;
  return finish(
    "review",
    `${caseFile.drafts.length} draft rule version(s) awaiting human approval` +
      (flagged ? `, ${flagged} flagged for attention` : ""),
  );
}
