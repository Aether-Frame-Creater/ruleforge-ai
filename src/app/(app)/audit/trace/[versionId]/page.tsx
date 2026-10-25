import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CAPABILITIES, requireRoleForPage } from "@/lib/auth/guards";
import {
  getChallengerResult,
  getImpactResult,
  getShadowRuns,
  traceRuleVersion,
} from "@/lib/queries";

export const instant = false;

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  createdAt: Date;
  details: unknown;
}

/**
 * The provenance chain for one rule version.
 *
 * Reads top to bottom as the story a regulator would ask for: which document,
 * which paragraph, quoted how, becoming which obligation, drafted into which
 * rule, measured how, reviewed by whom, and approved by whom.
 */
export default async function TracePage({
  params,
}: PageProps<"/audit/trace/[versionId]">) {
  const { versionId } = await params;
  await requireRoleForPage(
    CAPABILITIES.viewAuditTrail,
    `/audit/trace/${versionId}`,
  );

  const trace = await traceRuleVersion(versionId);
  if (!trace) notFound();

  const { version, obligation, backtest, approval, quote } = trace;

  const challenger = await getChallengerResult(versionId);
  const shadowRunRows = await getShadowRuns(versionId);
  const impact =
    backtest && obligation?.circularId
      ? await getImpactResult(obligation.circularId, backtest.id)
      : null;

  const steps: Array<{
    label: string;
    title: string;
    body: React.ReactNode;
    events: AuditEntry[];
  }> = [
    {
      label: "Circular",
      title: obligation?.circularTitle ?? "Source circular",
      body: obligation?.circularId ? (
        <Link
          href={`/circulars/${obligation.circularId}`}
          className="text-sm hover:underline"
        >
          Open the circular
        </Link>
      ) : (
        <span className="text-muted-foreground text-sm">
          No circular is linked to this version.
        </span>
      ),
      events: trace.circularEvents,
    },
    {
      label: "Paragraph and quote",
      title: obligation?.paragraphRef ?? "Source paragraph",
      body: (
        <div className="space-y-2">
          {quote ? (
            <blockquote className="border-primary/40 border-l-2 pl-3 text-sm italic">
              “{quote}”
            </blockquote>
          ) : (
            <span className="text-muted-foreground text-sm">
              No verified quote was recorded.
            </span>
          )}
          {obligation?.chunkText && (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {obligation.chunkText}
            </p>
          )}
        </div>
      ),
      events: [],
    },
    {
      label: "Obligation",
      title: obligation?.summary ?? "No obligation linked",
      body: obligation ? (
        <StatusBadge status={obligation.status} />
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
      events: trace.obligationEvents,
    },
    {
      label: "Rule version",
      title: `${version.ruleCode} v${version.version}`,
      body: (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={version.status} />
            {version.createdByAgent && (
              <span className="text-muted-foreground text-xs">
                drafted by {version.createdByAgent}
              </span>
            )}
          </div>
          <p className="text-sm">{version.changeSummary ?? "—"}</p>
          <pre className="bg-muted overflow-x-auto rounded p-2 font-mono text-[11px]">
            {JSON.stringify(version.jsonLogic)}
          </pre>
        </div>
      ),
      events: trace.versionEvents.filter(
        (event) => !event.action.startsWith("rule_version.challenge_"),
      ),
    },
    {
      label: "Backtest",
      title: backtest
        ? `${backtest.oldAlerts} → ${backtest.newAlerts} alerts`
        : "No backtest recorded",
      body: backtest ? (
        <div className="text-sm">
          <p>
            {backtest.totalTxns.toLocaleString("en-US")} transactions replayed ·{" "}
            {backtest.customersAffected.toLocaleString("en-US")} customers
            affected
          </p>
          {impact && (
            <p className="text-muted-foreground mt-1.5">
              <StatusBadge status={impact.riskLevel} className="mr-2" />
              {impact.summary}
            </p>
          )}
        </div>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
      events: [],
    },
    {
      label: "Challenger",
      title: challenger
        ? `Independent review: ${challenger.verdict}`
        : "No challenger verdict",
      body: challenger ? (
        <div className="space-y-1.5">
          <StatusBadge status={challenger.verdict} />
          <ul className="text-muted-foreground space-y-1 text-sm">
            {challenger.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
      events: trace.versionEvents.filter((event) =>
        event.action.startsWith("rule_version.challenge_"),
      ),
    },
    {
      label: "Approval",
      title: approval
        ? `${approval.decision} by ${approval.checkerName ?? "a head of compliance"}`
        : "Not yet decided",
      body: approval ? (
        <div className="space-y-1.5">
          <StatusBadge status={approval.decision} />
          {approval.comment && <p className="text-sm">“{approval.comment}”</p>}
          <p className="text-muted-foreground text-xs">
            {approval.createdAt.toLocaleString("en-GB")}
          </p>
        </div>
      ) : (
        <span className="text-muted-foreground text-sm">
          This version has not been through maker-checker yet.
        </span>
      ),
      events: [],
    },
    {
      label: "Shadow",
      title:
        shadowRunRows.length > 0
          ? `${shadowRunRows.length} shadow comparison${shadowRunRows.length === 1 ? "" : "s"}`
          : "Never run in shadow",
      body:
        shadowRunRows.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {shadowRunRows.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-x-2">
                <span className="tabular-nums">
                  {run.liveAlerts} live → {run.shadowAlerts} shadow
                </span>
                <span className="text-muted-foreground text-xs">
                  +{run.alertsOnlyShadow} / −{run.alertsOnlyLive} over{" "}
                  {run.txnsEvaluated.toLocaleString("en-US")} txns
                </span>
                <span className="text-muted-foreground ml-auto text-xs">
                  {run.createdByName ?? "—"} ·{" "}
                  {run.createdAt.toLocaleString("en-GB")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground text-sm">
            This version was never observed alongside the live rule.
          </span>
        ),
      events: trace.versionEvents.filter((event) =>
        event.action.startsWith("rule_version.shadow_"),
      ),
    },
    {
      label: "Rollout",
      title:
        version.status === "live"
          ? `Live${version.liveAt ? ` since ${version.liveAt.toLocaleString("en-GB")}` : ""}`
          : version.rolloutPercent > 0
            ? `Rolled out to ${version.rolloutPercent}% of customers`
            : "Never rolled out",
      body: (
        <div className="space-y-1.5">
          <StatusBadge status={version.status} />
          <p className="text-muted-foreground text-sm">
            {version.status === "retired"
              ? "A newer version replaced this one."
              : version.status === "live"
                ? "In force for every customer."
                : version.rolloutPercent > 0
                  ? "A stable hash of customer_id decides who is on it."
                  : "No customer has been on this version."}
          </p>
        </div>
      ),
      events: trace.versionEvents.filter(
        (event) =>
          event.action === "rule_version.rollout_set" ||
          event.action === "rule_version.went_live",
      ),
    },
    {
      label: "Rollback",
      title: version.rollbackReason
        ? "Rolled back"
        : "Not rolled back",
      body: version.rollbackReason ? (
        <div className="space-y-1.5">
          <StatusBadge status="rolled_back" />
          <p className="text-sm">“{version.rollbackReason}”</p>
          {version.rolledBackAt && (
            <p className="text-muted-foreground text-xs">
              {version.rolledBackAt.toLocaleString("en-GB")}
            </p>
          )}
        </div>
      ) : (
        <span className="text-muted-foreground text-sm">
          This version is not under a rollback.
        </span>
      ),
      events: trace.versionEvents.filter(
        (event) => event.action === "rule_version.rolled_back",
      ),
    },
  ];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/audit">
          <ArrowLeft className="mr-1.5 size-4" />
          Audit trail
        </Link>
      </Button>

      <PageHeader
        title={`Trace · ${version.ruleCode} v${version.version}`}
        description="Every link in the chain from the source document to the decision."
      />

      <ol className="space-y-4">
        {steps.map((step, index) => (
          <li key={step.label} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className="bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold">
                {index + 1}
              </div>
              {index < steps.length - 1 && (
                <div className="bg-border my-1 w-px flex-1" />
              )}
            </div>

            <Card className="flex-1">
              <CardHeader>
                <CardDescription className="text-xs uppercase">
                  {step.label}
                </CardDescription>
                <CardTitle className="text-base">{step.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {step.body}

                {step.events.length > 0 && (
                  <ul className="space-y-1 border-t pt-2">
                    {step.events.map((event) => (
                      <li
                        key={event.id}
                        className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 text-xs"
                      >
                        <code>{event.action}</code>
                        <span>{event.actor}</span>
                        <span className="ml-auto whitespace-nowrap">
                          {event.createdAt.toLocaleString("en-GB")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
