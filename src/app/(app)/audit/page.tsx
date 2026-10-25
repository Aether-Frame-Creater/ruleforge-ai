import { ScrollText } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { AuditSearch } from "@/components/app/audit-search";
import { Card, CardContent } from "@/components/ui/card";
import { CAPABILITIES, requireRoleForPage } from "@/lib/auth/guards";
import { searchAuditLog } from "@/lib/queries";

export const instant = false;

export const metadata = { title: "Audit trail — RuleForge AI" };

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requireRoleForPage(CAPABILITIES.viewAuditTrail, "/audit");

  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const entries = await searchAuditLog({ query, limit: 200 });

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Append-only. Rows cannot be edited or deleted — the database refuses."
      />

      <AuditSearch initialQuery={query} />

      {entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={query ? "Nothing matches that search" : "No audit entries yet"}
          description={
            query
              ? "Try an actor, an action, an entity type or an id."
              : "Entries appear as soon as anything happens."
          }
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <CardContent className="p-0">
            <ul className="divide-y">
              {entries.map((entry) => (
                <li key={entry.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <code className="text-sm font-medium">{entry.action}</code>
                    <span className="text-muted-foreground text-xs">
                      {entry.actor}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {entry.entityType}
                    </span>
                    <span className="text-muted-foreground ml-auto text-xs whitespace-nowrap">
                      {entry.createdAt.toLocaleString("en-GB")}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-0.5 font-mono text-[11px]">
                    {entry.entityId}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
