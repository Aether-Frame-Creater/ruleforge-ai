import { ArrowLeft, FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AgentTimeline } from "@/components/app/agent-timeline";
import { ObligationsPanel } from "@/components/app/obligations-panel";
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
import { can, requireUser } from "@/lib/auth/guards";
import {
  getAgentRuns,
  getCircular,
  getCircularChunks,
  getCircularDrafts,
  getCircularObligations,
} from "@/lib/queries";

export const instant = false;

/** The page hosts the `continue` action that runs later pipeline slices. */
export const maxDuration = 60;

export default async function CircularPage({
  params,
}: PageProps<"/circulars/[id]">) {
  const { id } = await params;
  const user = await requireUser(`/circulars/${id}`);

  const circular = await getCircular(id);
  if (!circular) notFound();

  const [chunks, obligations, runs, drafts] = await Promise.all([
    getCircularChunks(id),
    getCircularObligations(id),
    getAgentRuns(id),
    getCircularDrafts(id),
  ]);

  const settled =
    circular.status !== "uploaded" &&
    circular.status !== "analysing" &&
    !runs.some((run) => run.status === "running" || run.status === "queued");

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/circulars">
          <ArrowLeft className="mr-1.5 size-4" />
          All circulars
        </Link>
      </Button>

      <PageHeader
        title={circular.title}
        description={[
          circular.regulator.toUpperCase(),
          circular.circularNumber,
          circular.issuedDate ? `issued ${circular.issuedDate}` : null,
          circular.uploadedByName ? `uploaded by ${circular.uploadedByName}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={<StatusBadge status={circular.status} className="mt-1" />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {circular.applicabilityReason && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Applicability</CardTitle>
                <CardDescription>
                  {circular.status === "not_applicable"
                    ? "This circular does not bind the bank."
                    : "This circular applies to the bank."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">
                  {circular.applicabilityReason}
                </p>
              </CardContent>
            </Card>
          )}

          {drafts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Draft rule versions ({drafts.length})
                </CardTitle>
                <CardDescription>
                  Produced from this circular. Nothing is in force until a head
                  approves it.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {drafts.map((draft) => (
                    <li
                      key={draft.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                    >
                      <Link
                        href={`/drafts/${draft.id}`}
                        className="font-mono text-sm font-medium hover:underline"
                      >
                        {draft.ruleCode} v{draft.version}
                      </Link>
                      <StatusBadge status={draft.status} />
                      <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                        {draft.changeSummary}
                      </span>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/drafts/${draft.id}`}>Review</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {obligations.length > 0 || settled ? (
            <ObligationsPanel
              obligations={obligations}
              paragraphs={chunks}
              canReview={can(user.role, "reviewObligations")}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Obligations</CardTitle>
                <CardDescription>
                  Extraction has not finished yet — this fills in as the agents
                  work.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  <FileText className="size-4" />
                  Waiting for the obligation agent…
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="lg:col-span-1">
          <AgentTimeline
            circularId={id}
            initialSettled={settled}
            initialRuns={runs.map((run) => ({
              ...run,
              startedAt: run.startedAt?.toISOString() ?? null,
              finishedAt: run.finishedAt?.toISOString() ?? null,
            }))}
          />
        </div>
      </div>
    </>
  );
}
