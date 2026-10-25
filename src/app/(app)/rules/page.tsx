import { Scale } from "lucide-react";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";
import { getRuleLifecycles } from "@/lib/queries";
import { explainRule } from "@/rules/engine";

export const instant = false;

export const metadata = { title: "Rules — RuleForge AI" };

function safeExplain(logic: unknown): string {
  try {
    return explainRule(logic);
  } catch {
    return "This rule cannot be rendered in plain English.";
  }
}

export default async function RulesPage() {
  await requireUser("/rules");
  const rules = await getRuleLifecycles();

  return (
    <>
      <PageHeader
        title="Rules"
        description="Every rule, the version in force, and the full version history."
      />

      {rules.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No rules yet"
          description="Seed the demo data with `npm run db:seed` to create the starting rule set."
        />
      ) : (
        <div className="space-y-4">
          {rules.map((rule) => {
            const live = rule.versions.find(
              (version) => version.id === rule.currentVersionId,
            );
            return (
              <Card key={rule.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        <span className="font-mono">{rule.code}</span>
                        <span>{rule.name}</span>
                        <StatusBadge status={rule.category} />
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {live
                          ? safeExplain(live.jsonLogic)
                          : "No version is currently in force."}
                      </CardDescription>
                    </div>
                    {live && (
                      <StatusBadge status="live" className="shrink-0" />
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-muted-foreground mb-2 text-xs font-medium">
                    Version history
                  </div>
                  <ul className="space-y-3 text-sm">
                    {rule.versions.map((version) => (
                      <li key={version.id} className="border-t pt-3 first:border-0 first:pt-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <Link
                            href={`/drafts/${version.id}`}
                            className="font-mono text-xs font-medium hover:underline"
                          >
                            v{version.version}
                          </Link>
                          <StatusBadge status={version.status} />
                          {version.status === "shadow" && version.rolloutPercent > 0 && (
                            <span className="text-muted-foreground text-xs tabular-nums">
                              {version.rolloutPercent}% rollout
                            </span>
                          )}
                          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                            {version.changeSummary ?? "—"}
                          </span>
                          <Link
                            href={`/audit/trace/${version.id}`}
                            className="text-xs hover:underline"
                          >
                            Trace
                          </Link>
                        </div>

                        {version.rollbackReason && (
                          <p className="text-destructive mt-1 text-xs">
                            Rolled back: {version.rollbackReason}
                          </p>
                        )}

                        {/* draft → submitted → approved → shadow → live → retired */}
                        <ol className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1.5">
                          {version.timeline.map((step, index) => (
                            <li key={`${step.status}-${index}`} className="flex items-center gap-1">
                              {index > 0 && (
                                <span className="text-muted-foreground/50 text-xs">→</span>
                              )}
                              <span className="bg-muted/60 rounded px-1.5 py-0.5 text-[11px]">
                                <span className="font-medium">
                                  {step.status.replace(/_/g, " ")}
                                </span>
                                {step.actor && (
                                  <span className="text-muted-foreground">
                                    {" "}
                                    · {step.actor.replace(/^user:|^agent:/, "")}
                                  </span>
                                )}
                                {step.at && (
                                  <span className="text-muted-foreground">
                                    {" "}
                                    · {step.at.toLocaleDateString("en-GB")}
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                          {version.timeline.length === 0 && (
                            <li className="text-muted-foreground text-[11px]">
                              No recorded lifecycle events
                            </li>
                          )}
                        </ol>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
