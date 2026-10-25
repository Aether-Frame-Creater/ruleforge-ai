import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { ShadowConsole } from "@/components/app/shadow-console";
import { Button } from "@/components/ui/button";
import { requireRoleForPage } from "@/lib/auth/guards";
import { getRuleVersionDetail, getShadowRuns } from "@/lib/queries";
import { explainRule } from "@/rules/engine";

export const instant = false;

function safeExplain(logic: unknown): string | null {
  try {
    return explainRule(logic);
  } catch {
    return null;
  }
}

export default async function RolloutDetailPage({
  params,
}: PageProps<"/rollout/[versionId]">) {
  const { versionId } = await params;
  const user = await requireRoleForPage(
    ["ops", "head", "auditor"],
    `/rollout/${versionId}`,
  );

  const detail = await getRuleVersionDetail(versionId);
  if (!detail) notFound();

  const runs = await getShadowRuns(versionId);
  const { version, baseline } = detail;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/rollout">
          <ArrowLeft className="mr-1.5 size-4" />
          Rollout board
        </Link>
      </Button>

      <PageHeader
        title={`${version.ruleCode} v${version.version}`}
        description={[version.ruleName, version.ruleCategory.toUpperCase()]
          .filter(Boolean)
          .join(" · ")}
      />

      <ShadowConsole
        canAct={user.role === "ops"}
        data={{
          ruleVersionId: version.id,
          ruleId: version.ruleId,
          ruleCode: version.ruleCode,
          version: version.version,
          status: version.status,
          rolloutPercent: version.rolloutPercent,
          explanation:
            safeExplain(version.jsonLogic) ??
            "This rule cannot be rendered in plain English.",
          baselineExplanation:
            baseline && baseline.id !== version.id
              ? safeExplain(baseline.jsonLogic)
              : null,
          runs: runs.map((run) => ({
            id: run.id,
            txnsEvaluated: run.txnsEvaluated,
            liveAlerts: run.liveAlerts,
            shadowAlerts: run.shadowAlerts,
            alertsOnlyLive: run.alertsOnlyLive,
            alertsOnlyShadow: run.alertsOnlyShadow,
            alertRateChangePct: run.alertRateChangePct,
            createdAt: run.createdAt.toISOString(),
            createdByName: run.createdByName,
            simulated: Boolean(
              (run.resultJson as { simulated?: boolean } | null)?.simulated,
            ),
          })),
        }}
      />
    </>
  );
}
