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
import { listRulesWithVersions } from "@/lib/queries";
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
  const rules = await listRulesWithVersions();

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
                  <ul className="divide-y text-sm">
                    {rule.versions.map((version) => (
                      <li
                        key={version.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                      >
                        <Link
                          href={`/drafts/${version.id}`}
                          className="font-mono text-xs font-medium hover:underline"
                        >
                          v{version.version}
                        </Link>
                        <StatusBadge status={version.status} />
                        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                          {version.changeSummary ?? "—"}
                        </span>
                        <span className="text-muted-foreground text-xs whitespace-nowrap">
                          {version.createdAt.toLocaleDateString("en-GB")}
                        </span>
                        <Link
                          href={`/audit/trace/${version.id}`}
                          className="text-xs hover:underline"
                        >
                          Trace
                        </Link>
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
