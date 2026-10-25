/**
 * Read queries for the pages.
 *
 * Kept apart from the server actions: these never write and never check a
 * role, so a page can compose them freely once it has decided who is allowed
 * to see the page at all.
 */
import "server-only";

import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import {
  agentRuns,
  approvals,
  auditLog,
  backtestRuns,
  circularChunks,
  circulars,
  obligations,
  rules,
  ruleVersions,
  shadowRuns,
  user,
} from "@/db/schema";
import { db } from "@/lib/db";

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export async function dashboardSummary() {
  const [byStatus, awaitingApproval, liveRules, recentAudit, draftCount] =
    await Promise.all([
      db
        .select({ status: circulars.status, n: count() })
        .from(circulars)
        .groupBy(circulars.status),
      db
        .select({ n: count() })
        .from(ruleVersions)
        .where(eq(ruleVersions.status, "submitted")),
      db
        .select({ n: count() })
        .from(ruleVersions)
        .where(eq(ruleVersions.status, "live")),
      db
        .select({
          id: auditLog.id,
          actor: auditLog.actor,
          action: auditLog.action,
          entityType: auditLog.entityType,
          entityId: auditLog.entityId,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(10),
      db
        .select({ n: count() })
        .from(ruleVersions)
        .where(eq(ruleVersions.status, "draft")),
    ]);

  return {
    circularsByStatus: byStatus,
    circularTotal: byStatus.reduce((total, row) => total + row.n, 0),
    awaitingApproval: awaitingApproval[0]?.n ?? 0,
    liveRules: liveRules[0]?.n ?? 0,
    openDrafts: draftCount[0]?.n ?? 0,
    recentAudit,
  };
}

/* -------------------------------------------------------------------------- */
/* Circulars                                                                  */
/* -------------------------------------------------------------------------- */

export async function listCirculars() {
  return db
    .select({
      id: circulars.id,
      title: circulars.title,
      regulator: circulars.regulator,
      circularNumber: circulars.circularNumber,
      issuedDate: circulars.issuedDate,
      status: circulars.status,
      createdAt: circulars.createdAt,
      uploadedByName: user.name,
      obligationCount: sql<number>`(
        select count(*)::int from ${obligations} where ${obligations.circularId} = ${circulars.id}
      )`,
    })
    .from(circulars)
    .leftJoin(user, eq(user.id, circulars.uploadedBy))
    .orderBy(desc(circulars.createdAt));
}

export async function getCircular(id: string) {
  const [row] = await db
    .select({
      id: circulars.id,
      title: circulars.title,
      regulator: circulars.regulator,
      circularNumber: circulars.circularNumber,
      issuedDate: circulars.issuedDate,
      status: circulars.status,
      applicabilityReason: circulars.applicabilityReason,
      pdfUrl: circulars.pdfUrl,
      createdAt: circulars.createdAt,
      uploadedByName: user.name,
    })
    .from(circulars)
    .leftJoin(user, eq(user.id, circulars.uploadedBy))
    .where(eq(circulars.id, id))
    .limit(1);
  return row ?? null;
}

export async function getCircularChunks(circularId: string) {
  return db
    .select({
      id: circularChunks.id,
      paragraphRef: circularChunks.paragraphRef,
      text: circularChunks.text,
    })
    .from(circularChunks)
    .where(eq(circularChunks.circularId, circularId))
    .orderBy(circularChunks.createdAt);
}

export async function getCircularObligations(circularId: string) {
  return db
    .select({
      id: obligations.id,
      summary: obligations.summary,
      obligationType: obligations.obligationType,
      deadline: obligations.deadline,
      status: obligations.status,
      chunkId: obligations.chunkId,
      paragraphRef: circularChunks.paragraphRef,
      chunkText: circularChunks.text,
      reviewedByName: user.name,
      // The verified quote lives on the audit entry written when the
      // obligation was extracted, which is the authoritative record of what
      // the quote check actually matched.
      quote: sql<string | null>`(
        select ${auditLog.details} ->> 'quote'
        from ${auditLog}
        where ${auditLog.entityType} = 'obligations'
          and ${auditLog.entityId} = ${obligations.id}::text
          and ${auditLog.action} = 'obligation.extracted'
        limit 1
      )`,
    })
    .from(obligations)
    .leftJoin(circularChunks, eq(circularChunks.id, obligations.chunkId))
    .leftJoin(user, eq(user.id, obligations.reviewedBy))
    .where(eq(obligations.circularId, circularId))
    .orderBy(obligations.createdAt);
}

/** Drafts produced for a circular, via the obligations it raised. */
export async function getCircularDrafts(circularId: string) {
  return db
    .selectDistinctOn([ruleVersions.id], {
      id: ruleVersions.id,
      version: ruleVersions.version,
      status: ruleVersions.status,
      changeSummary: ruleVersions.changeSummary,
      ruleCode: rules.code,
      ruleName: rules.name,
    })
    .from(ruleVersions)
    .innerJoin(rules, eq(rules.id, ruleVersions.ruleId))
    .innerJoin(obligations, eq(obligations.id, ruleVersions.obligationId))
    .where(eq(obligations.circularId, circularId))
    .orderBy(ruleVersions.id);
}

/* -------------------------------------------------------------------------- */
/* Agent runs                                                                 */
/* -------------------------------------------------------------------------- */

export interface AgentRunRow {
  id: string;
  agentName: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  model: string | null;
  mode: string | null;
  fromCache: boolean | null;
  envelopeIn: unknown;
  envelopeOut: unknown;
}

export async function getAgentRuns(circularId: string): Promise<AgentRunRow[]> {
  const rows = await db
    .select({
      id: agentRuns.id,
      agentName: agentRuns.agentName,
      status: agentRuns.status,
      error: agentRuns.error,
      startedAt: agentRuns.startedAt,
      finishedAt: agentRuns.finishedAt,
      input: agentRuns.input,
      output: agentRuns.output,
    })
    .from(agentRuns)
    .where(eq(agentRuns.circularId, circularId))
    .orderBy(agentRuns.startedAt);

  return rows.map((row) => {
    const output = (row.output ?? {}) as Record<string, unknown>;
    const input = (row.input ?? {}) as Record<string, unknown>;
    const timing = (output.timing ?? {}) as Record<string, unknown>;

    return {
      id: row.id,
      agentName: row.agentName,
      status: row.status,
      error: row.error,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs:
        typeof timing.duration_ms === "number" ? timing.duration_ms : null,
      model: typeof output.model === "string" ? output.model : null,
      mode:
        typeof output.mode === "string"
          ? output.mode
          : typeof input.mode === "string"
            ? input.mode
            : null,
      fromCache:
        typeof output.from_cache === "boolean" ? output.from_cache : null,
      envelopeIn: input.envelope ?? null,
      envelopeOut: output.envelope ?? null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Rule versions                                                              */
/* -------------------------------------------------------------------------- */

export async function getRuleVersionDetail(ruleVersionId: string) {
  const [version] = await db
    .select({
      id: ruleVersions.id,
      version: ruleVersions.version,
      status: ruleVersions.status,
      jsonLogic: ruleVersions.jsonLogic,
      changeSummary: ruleVersions.changeSummary,
      createdByAgent: ruleVersions.createdByAgent,
      createdAt: ruleVersions.createdAt,
      rolloutPercent: ruleVersions.rolloutPercent,
      shadowStartedAt: ruleVersions.shadowStartedAt,
      liveAt: ruleVersions.liveAt,
      rolledBackAt: ruleVersions.rolledBackAt,
      rollbackReason: ruleVersions.rollbackReason,
      submittedAt: ruleVersions.submittedAt,
      submittedById: ruleVersions.submittedBy,
      submittedByName: user.name,
      ruleId: rules.id,
      ruleCode: rules.code,
      ruleName: rules.name,
      ruleCategory: rules.category,
      currentVersionId: rules.currentVersionId,
      obligationId: ruleVersions.obligationId,
    })
    .from(ruleVersions)
    .innerJoin(rules, eq(rules.id, ruleVersions.ruleId))
    .leftJoin(user, eq(user.id, ruleVersions.submittedBy))
    .where(eq(ruleVersions.id, ruleVersionId))
    .limit(1);

  if (!version) return null;

  const [baseline] = version.currentVersionId
    ? await db
        .select({
          id: ruleVersions.id,
          version: ruleVersions.version,
          jsonLogic: ruleVersions.jsonLogic,
        })
        .from(ruleVersions)
        .where(eq(ruleVersions.id, version.currentVersionId))
        .limit(1)
    : [];

  const [backtest] = await db
    .select({
      id: backtestRuns.id,
      totalTxns: backtestRuns.totalTxns,
      oldAlerts: backtestRuns.oldAlerts,
      newAlerts: backtestRuns.newAlerts,
      customersAffected: backtestRuns.customersAffected,
      resultJson: backtestRuns.resultJson,
      createdAt: backtestRuns.createdAt,
    })
    .from(backtestRuns)
    .where(eq(backtestRuns.ruleVersionId, ruleVersionId))
    .orderBy(desc(backtestRuns.createdAt))
    .limit(1);

  const obligation = version.obligationId
    ? (
        await db
          .select({
            id: obligations.id,
            summary: obligations.summary,
            status: obligations.status,
            circularId: obligations.circularId,
            circularTitle: circulars.title,
            paragraphRef: circularChunks.paragraphRef,
            chunkText: circularChunks.text,
          })
          .from(obligations)
          .leftJoin(circulars, eq(circulars.id, obligations.circularId))
          .leftJoin(circularChunks, eq(circularChunks.id, obligations.chunkId))
          .where(eq(obligations.id, version.obligationId))
          .limit(1)
      )[0]
    : undefined;

  const [approval] = await db
    .select({
      id: approvals.id,
      decision: approvals.decision,
      comment: approvals.comment,
      createdAt: approvals.createdAt,
      checkerName: user.name,
      checkerId: approvals.checkerId,
      makerId: approvals.makerId,
    })
    .from(approvals)
    .leftJoin(user, eq(user.id, approvals.checkerId))
    .where(eq(approvals.ruleVersionId, ruleVersionId))
    .orderBy(desc(approvals.createdAt))
    .limit(1);

  return {
    version,
    baseline: baseline ?? null,
    backtest: backtest ?? null,
    obligation: obligation ?? null,
    approval: approval ?? null,
  };
}

export async function listSubmittedDrafts() {
  return db
    .select({
      id: ruleVersions.id,
      version: ruleVersions.version,
      changeSummary: ruleVersions.changeSummary,
      submittedAt: ruleVersions.submittedAt,
      submittedById: ruleVersions.submittedBy,
      submittedByName: user.name,
      ruleCode: rules.code,
      ruleName: rules.name,
      ruleCategory: rules.category,
    })
    .from(ruleVersions)
    .innerJoin(rules, eq(rules.id, ruleVersions.ruleId))
    .leftJoin(user, eq(user.id, ruleVersions.submittedBy))
    .where(eq(ruleVersions.status, "submitted"))
    .orderBy(desc(ruleVersions.submittedAt));
}

export async function listRulesWithVersions() {
  const ruleRows = await db
    .select({
      id: rules.id,
      code: rules.code,
      name: rules.name,
      description: rules.description,
      category: rules.category,
      currentVersionId: rules.currentVersionId,
    })
    .from(rules)
    .orderBy(rules.code);

  const versionRows = await db
    .select({
      id: ruleVersions.id,
      ruleId: ruleVersions.ruleId,
      version: ruleVersions.version,
      status: ruleVersions.status,
      jsonLogic: ruleVersions.jsonLogic,
      changeSummary: ruleVersions.changeSummary,
      createdAt: ruleVersions.createdAt,
      createdByAgent: ruleVersions.createdByAgent,
    })
    .from(ruleVersions)
    .orderBy(desc(ruleVersions.version));

  return ruleRows.map((rule) => ({
    ...rule,
    versions: versionRows.filter((version) => version.ruleId === rule.id),
  }));
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

export async function searchAuditLog(options: {
  query?: string;
  limit?: number;
}) {
  const limit = Math.min(options.limit ?? 100, 500);
  const term = options.query?.trim();

  const where = term
    ? or(
        ilike(auditLog.actor, `%${term}%`),
        ilike(auditLog.action, `%${term}%`),
        ilike(auditLog.entityType, `%${term}%`),
        ilike(auditLog.entityId, `%${term}%`),
      )
    : undefined;

  return db
    .select({
      id: auditLog.id,
      actor: auditLog.actor,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      details: auditLog.details,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

/**
 * The full provenance chain for one rule version:
 * circular → paragraph and quote → obligation → version → backtest →
 * challenger → approval.
 */
export async function traceRuleVersion(ruleVersionId: string) {
  const detail = await getRuleVersionDetail(ruleVersionId);
  if (!detail) return null;

  const quoteEntry = detail.obligation
    ? (
        await db
          .select({ details: auditLog.details, createdAt: auditLog.createdAt })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.entityType, "obligations"),
              eq(auditLog.entityId, detail.obligation.id),
              eq(auditLog.action, "obligation.extracted"),
            ),
          )
          .limit(1)
      )[0]
    : undefined;

  const versionEvents = await db
    .select({
      id: auditLog.id,
      actor: auditLog.actor,
      action: auditLog.action,
      details: auditLog.details,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, "rule_versions"),
        eq(auditLog.entityId, ruleVersionId),
      ),
    )
    .orderBy(auditLog.createdAt);

  const obligationEvents = detail.obligation
    ? await db
        .select({
          id: auditLog.id,
          actor: auditLog.actor,
          action: auditLog.action,
          details: auditLog.details,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityType, "obligations"),
            eq(auditLog.entityId, detail.obligation.id),
          ),
        )
        .orderBy(auditLog.createdAt)
    : [];

  const circularEvents = detail.obligation?.circularId
    ? await db
        .select({
          id: auditLog.id,
          actor: auditLog.actor,
          action: auditLog.action,
          details: auditLog.details,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityType, "circulars"),
            eq(auditLog.entityId, detail.obligation.circularId),
          ),
        )
        .orderBy(auditLog.createdAt)
    : [];

  return {
    ...detail,
    quote:
      quoteEntry?.details &&
      typeof quoteEntry.details === "object" &&
      "quote" in quoteEntry.details
        ? String((quoteEntry.details as { quote: unknown }).quote)
        : null,
    circularEvents,
    obligationEvents,
    versionEvents,
  };
}

/* -------------------------------------------------------------------------- */
/* Draft review extras                                                        */
/* -------------------------------------------------------------------------- */

export interface ChallengerResult {
  verdict: "pass" | "fail";
  severity: string | null;
  reasons: string[];
  round: number | null;
  at: Date;
}

export interface ImpactResult {
  summary: string;
  riskLevel: "low" | "medium" | "high";
  drivers: string[];
}

/**
 * The challenger's verdict on a version, read from the audit trail.
 *
 * The audit entry is the record of what the reviewer actually concluded, which
 * is what a person reading this page needs to see.
 */
export async function getChallengerResult(
  ruleVersionId: string,
): Promise<ChallengerResult | null> {
  const rows = await db
    .select({
      action: auditLog.action,
      details: auditLog.details,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, "rule_versions"),
        eq(auditLog.entityId, ruleVersionId),
      ),
    )
    .orderBy(desc(auditLog.createdAt));

  const entry = rows.find((row) =>
    row.action.startsWith("rule_version.challenge_"),
  );
  if (!entry) return null;

  const details = (entry.details ?? {}) as Record<string, unknown>;
  return {
    verdict: entry.action.endsWith("_pass") ? "pass" : "fail",
    severity: typeof details.severity === "string" ? details.severity : null,
    reasons: Array.isArray(details.reasons)
      ? details.reasons.map((reason) => String(reason))
      : [],
    round: typeof details.round === "number" ? details.round : null,
    at: entry.createdAt,
  };
}

/**
 * The impact agent's summary for a backtest run.
 *
 * Matched on the backtest run id carried in the agent's request envelope: a
 * circular can produce several drafts, and each has its own impact summary.
 */
export async function getImpactResult(
  circularId: string,
  backtestRunId: string,
): Promise<ImpactResult | null> {
  const rows = await db
    .select({ input: agentRuns.input, output: agentRuns.output })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.circularId, circularId),
        eq(agentRuns.agentName, "impact_agent"),
        eq(agentRuns.status, "succeeded"),
      ),
    )
    .orderBy(desc(agentRuns.startedAt));

  for (const row of rows) {
    const input = row.input as
      | { envelope?: { payload?: { backtest_run_id?: string } } }
      | null;
    if (input?.envelope?.payload?.backtest_run_id !== backtestRunId) continue;

    const payload = (
      row.output as { envelope?: { payload?: Record<string, unknown> } } | null
    )?.envelope?.payload;
    if (!payload) continue;

    const risk = payload.risk_level;
    return {
      summary: String(payload.summary ?? ""),
      riskLevel:
        risk === "low" || risk === "medium" || risk === "high" ? risk : "medium",
      drivers: Array.isArray(payload.drivers)
        ? payload.drivers.map((driver) => String(driver))
        : [],
    };
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Rollout                                                                    */
/* -------------------------------------------------------------------------- */

/** One rule version as the rollout board shows it. */
export interface RolloutCard {
  id: string;
  version: number;
  status: string;
  rolloutPercent: number;
  changeSummary: string | null;
  jsonLogic: unknown;
  shadowStartedAt: Date | null;
  liveAt: Date | null;
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  ruleCategory: string;
  shadowRunCount: number;
  latestAlertRateChangePct: string | null;
}

/** Versions in the three columns of the rollout board. */
export async function listRolloutBoard(): Promise<{
  approved: RolloutCard[];
  shadow: RolloutCard[];
  live: RolloutCard[];
}> {
  const rows = await db
    .select({
      id: ruleVersions.id,
      version: ruleVersions.version,
      status: ruleVersions.status,
      rolloutPercent: ruleVersions.rolloutPercent,
      changeSummary: ruleVersions.changeSummary,
      jsonLogic: ruleVersions.jsonLogic,
      shadowStartedAt: ruleVersions.shadowStartedAt,
      liveAt: ruleVersions.liveAt,
      ruleId: rules.id,
      ruleCode: rules.code,
      ruleName: rules.name,
      ruleCategory: rules.category,
      shadowRunCount: sql<number>`(
        select count(*)::int from ${shadowRuns}
        where ${shadowRuns.ruleVersionId} = ${ruleVersions.id}
      )`,
      latestAlertRateChangePct: sql<string | null>`(
        select ${shadowRuns.alertRateChangePct} from ${shadowRuns}
        where ${shadowRuns.ruleVersionId} = ${ruleVersions.id}
        order by ${shadowRuns.createdAt} desc limit 1
      )`,
    })
    .from(ruleVersions)
    .innerJoin(rules, eq(rules.id, ruleVersions.ruleId))
    .where(inArray(ruleVersions.status, ["approved", "shadow", "live"]))
    .orderBy(rules.code, desc(ruleVersions.version));

  return {
    approved: rows.filter((row) => row.status === "approved"),
    shadow: rows.filter((row) => row.status === "shadow"),
    live: rows.filter((row) => row.status === "live"),
  };
}

export async function getShadowRuns(ruleVersionId: string) {
  return db
    .select({
      id: shadowRuns.id,
      txnsEvaluated: shadowRuns.txnsEvaluated,
      liveAlerts: shadowRuns.liveAlerts,
      shadowAlerts: shadowRuns.shadowAlerts,
      alertsOnlyLive: shadowRuns.alertsOnlyLive,
      alertsOnlyShadow: shadowRuns.alertsOnlyShadow,
      alertRateChangePct: shadowRuns.alertRateChangePct,
      resultJson: shadowRuns.resultJson,
      createdAt: shadowRuns.createdAt,
      createdByName: user.name,
    })
    .from(shadowRuns)
    .leftJoin(user, eq(user.id, shadowRuns.createdBy))
    .where(eq(shadowRuns.ruleVersionId, ruleVersionId))
    .orderBy(desc(shadowRuns.createdAt));
}

/**
 * The lifecycle of every version of a rule, with who did each step and when.
 *
 * The timeline is built from `audit_log` rather than from the version's own
 * columns: the columns say where a version ended up, the audit trail says how
 * it got there, and only the trail names the person.
 */
export interface LifecycleStep {
  status: string;
  at: Date | null;
  actor: string | null;
}

export async function getRuleLifecycles() {
  const ruleRows = await db
    .select({
      id: rules.id,
      code: rules.code,
      name: rules.name,
      category: rules.category,
      currentVersionId: rules.currentVersionId,
    })
    .from(rules)
    .orderBy(rules.code);

  const versionRows = await db
    .select({
      id: ruleVersions.id,
      ruleId: ruleVersions.ruleId,
      version: ruleVersions.version,
      status: ruleVersions.status,
      jsonLogic: ruleVersions.jsonLogic,
      changeSummary: ruleVersions.changeSummary,
      rolloutPercent: ruleVersions.rolloutPercent,
      createdAt: ruleVersions.createdAt,
      createdByAgent: ruleVersions.createdByAgent,
      rollbackReason: ruleVersions.rollbackReason,
    })
    .from(ruleVersions)
    .orderBy(desc(ruleVersions.version));

  // One pass over the audit trail; filtering per version in SQL would be a
  // query per version for a page that lists every rule.
  const events = await db
    .select({
      entityId: auditLog.entityId,
      action: auditLog.action,
      actor: auditLog.actor,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.entityType, "rule_versions"))
    .orderBy(auditLog.createdAt);

  /** Audit action → the lifecycle status it represents. */
  const STEP_FOR_ACTION: Record<string, string> = {
    "rule_version.drafted": "draft",
    "rule_version.submitted": "submitted",
    "rule_version.approved": "approved",
    "rule_version.rejected": "rejected",
    "rule_version.shadow_started": "shadow",
    "rule_version.went_live": "live",
    "rule_version.rolled_back": "rolled_back",
  };

  return ruleRows.map((rule) => ({
    ...rule,
    versions: versionRows
      .filter((version) => version.ruleId === rule.id)
      .map((version) => {
        const timeline: LifecycleStep[] = [];
        for (const event of events) {
          if (event.entityId !== version.id) continue;
          const status = STEP_FOR_ACTION[event.action];
          if (!status) continue;
          timeline.push({
            status,
            at: event.createdAt,
            actor: event.actor,
          });
        }
        // A version retired by a successor leaves no audit entry of its own —
        // the successor's `went_live` records it — so it is added from status.
        if (version.status === "retired") {
          timeline.push({ status: "retired", at: null, actor: null });
        }
        return { ...version, timeline };
      }),
  }));
}

/** Counts for the dashboard's shadow and rollback tiles. */
export async function deploymentCounts() {
  const [inShadow, rolledBack] = await Promise.all([
    db
      .select({ n: count() })
      .from(ruleVersions)
      .where(eq(ruleVersions.status, "shadow")),
    db
      .select({ n: count() })
      .from(ruleVersions)
      .where(eq(ruleVersions.status, "rolled_back")),
  ]);
  return {
    inShadow: inShadow[0]?.n ?? 0,
    rolledBack: rolledBack[0]?.n ?? 0,
  };
}
