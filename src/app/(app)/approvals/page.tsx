import { ClipboardCheck } from "lucide-react";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CAPABILITIES, requireRoleForPage } from "@/lib/auth/guards";
import { listSubmittedDrafts } from "@/lib/queries";

export const instant = false;

export const metadata = { title: "Approvals — RuleForge AI" };

export default async function ApprovalsPage() {
  // Heads decide; auditors may look. Enforced here, not by hiding the link.
  const user = await requireRoleForPage(
    [...CAPABILITIES.decideDraft, "auditor"],
    "/approvals",
  );
  const drafts = await listSubmittedDrafts();

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          user.role === "head"
            ? "Drafts submitted by compliance officers, waiting on your decision."
            : "Drafts waiting on a head of compliance. You have read-only access."
        }
      />

      {drafts.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Nothing is waiting for approval"
          description="Submitted drafts appear here. An officer submits them from the draft review page."
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead className="hidden md:table-cell">Change</TableHead>
                  <TableHead className="hidden sm:table-cell">Submitted by</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.map((draft) => (
                  <TableRow key={draft.id}>
                    <TableCell>
                      <Link
                        href={`/drafts/${draft.id}`}
                        className="font-mono text-sm font-medium hover:underline"
                      >
                        {draft.ruleCode} v{draft.version}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {draft.ruleName}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden max-w-sm truncate text-sm md:table-cell">
                      {draft.changeSummary ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">
                      {draft.submittedByName ?? "—"}
                      {draft.submittedAt && (
                        <div>{draft.submittedAt.toLocaleDateString("en-GB")}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status="submitted" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm">
                        <Link href={`/drafts/${draft.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
