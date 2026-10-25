import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DraftReview } from "@/components/app/draft-review";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { can, requireUser } from "@/lib/auth/guards";
import {
  getChallengerResult,
  getImpactResult,
  getRuleVersionDetail,
} from "@/lib/queries";
import { diffRules, explainRule } from "@/rules/engine";

export const instant = false;

/** `explainRule` throws on a rule that breaks the contract; never fail a page. */
function safeExplain(logic: unknown): string | null {
  try {
    return explainRule(logic);
  } catch {
    return null;
  }
}

function safeDiff(before: unknown, after: unknown): string[] {
  try {
    return diffRules(before, after).map((entry) => entry.message);
  } catch {
    return [];
  }
}

export default async function DraftPage({
  params,
}: PageProps<"/drafts/[versionId]">) {
  const { versionId } = await params;
  const user = await requireUser(`/drafts/${versionId}`);

  const detail = await getRuleVersionDetail(versionId);
  if (!detail) notFound();

  const { version, baseline, backtest, obligation, approval } = detail;

  const [challenger, impact] = await Promise.all([
    getChallengerResult(versionId),
    backtest && obligation?.circularId
      ? getImpactResult(obligation.circularId, backtest.id)
      : Promise.resolve(null),
  ]);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href={obligation?.circularId ? `/circulars/${obligation.circularId}` : "/rules"}>
          <ArrowLeft className="mr-1.5 size-4" />
          {obligation?.circularTitle ?? "Back"}
        </Link>
      </Button>

      <PageHeader
        title={`${version.ruleCode} v${version.version}`}
        description={[
          version.ruleName,
          version.ruleCategory.toUpperCase(),
          obligation?.paragraphRef ? `from ${obligation.paragraphRef}` : null,
          version.createdByAgent ? `drafted by ${version.createdByAgent}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      {obligation && (
        <div className="bg-muted/40 mb-6 rounded-lg border p-4">
          <div className="text-muted-foreground mb-1 text-xs font-medium">
            Obligation this version answers
            {obligation.paragraphRef ? ` · ${obligation.paragraphRef}` : ""}
          </div>
          <p className="text-sm">{obligation.summary}</p>
        </div>
      )}

      <DraftReview
        viewerId={user.id}
        canSubmit={can(user.role, "submitDraft")}
        canDecide={can(user.role, "decideDraft")}
        data={{
          ruleVersionId: version.id,
          ruleCode: version.ruleCode,
          ruleName: version.ruleName,
          ruleCategory: version.ruleCategory,
          version: version.version,
          status: version.status,
          changeSummary: version.changeSummary,
          createdByAgent: version.createdByAgent,
          submittedByName: version.submittedByName,
          submittedById: version.submittedById,
          jsonLogic: version.jsonLogic,
          explanation:
            safeExplain(version.jsonLogic) ??
            "This rule cannot be rendered in plain English.",
          baselineExplanation: baseline ? safeExplain(baseline.jsonLogic) : null,
          baselineVersion: baseline?.version ?? null,
          diff: baseline ? safeDiff(baseline.jsonLogic, version.jsonLogic) : [],
          backtest: backtest
            ? {
                id: backtest.id,
                totalTxns: backtest.totalTxns,
                oldAlerts: backtest.oldAlerts,
                newAlerts: backtest.newAlerts,
                customersAffected: backtest.customersAffected,
              }
            : null,
          impact,
          challenger,
          approval: approval
            ? {
                decision: approval.decision,
                comment: approval.comment,
                checkerName: approval.checkerName,
              }
            : null,
        }}
      />
    </>
  );
}
