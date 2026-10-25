"use client";

import { ChevronDown, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { StatusBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  decideDraftAction,
  submitDraftAction,
} from "@/lib/actions/approval-actions";

export interface DraftReviewData {
  ruleVersionId: string;
  ruleCode: string;
  ruleName: string;
  ruleCategory: string;
  version: number;
  status: string;
  changeSummary: string | null;
  createdByAgent: string | null;
  submittedByName: string | null;
  submittedById: string | null;
  jsonLogic: unknown;
  /** Plain-English rendering of the proposed rule. */
  explanation: string;
  /** Plain-English rendering of the version in force, if there is one. */
  baselineExplanation: string | null;
  baselineVersion: number | null;
  diff: string[];
  backtest: {
    id: string;
    totalTxns: number;
    oldAlerts: number;
    newAlerts: number;
    customersAffected: number;
  } | null;
  impact: {
    summary: string;
    riskLevel: "low" | "medium" | "high";
    drivers: string[];
  } | null;
  challenger: {
    verdict: "pass" | "fail";
    severity: string | null;
    reasons: string[];
  } | null;
  approval: {
    decision: string;
    comment: string | null;
    checkerName: string | null;
  } | null;
}

const chartConfig = {
  alerts: { label: "Alerts" },
  before: { label: "In force now", color: "var(--chart-2)" },
  after: { label: "Proposed", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function DraftReview({
  data,
  canSubmit,
  canDecide,
  viewerId,
}: {
  data: DraftReviewData;
  canSubmit: boolean;
  canDecide: boolean;
  viewerId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);

  // The database enforces maker ≠ checker as well; saying so up front is
  // kinder than letting someone write a comment and then refusing it.
  const isOwnSubmission = data.submittedById === viewerId;

  function onSubmit() {
    startTransition(async () => {
      const result = await submitDraftAction({
        ruleVersionId: data.ruleVersionId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Submitted for approval");
      router.refresh();
    });
  }

  function onDecide() {
    if (!decision) return;
    setCommentError(null);
    startTransition(async () => {
      const result = await decideDraftAction({
        ruleVersionId: data.ruleVersionId,
        decision,
        comment,
      });
      if (!result.ok) {
        setCommentError(result.fieldErrors?.comment?.[0] ?? result.error);
        return;
      }
      toast.success(`Draft ${decision}`);
      setDecision(null);
      setComment("");
      router.refresh();
      router.push("/approvals");
    });
  }

  const chartData = data.backtest
    ? [
        { name: "In force now", alerts: data.backtest.oldAlerts, fill: "var(--color-before)" },
        { name: "Proposed", alerts: data.backtest.newAlerts, fill: "var(--color-after)" },
      ]
    : [];

  const added = data.backtest
    ? data.backtest.newAlerts - data.backtest.oldAlerts
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">What changes</CardTitle>
            <CardDescription>
              {data.changeSummary ?? "No change summary was recorded."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground mb-1 text-xs font-medium">
                  In force now
                  {data.baselineVersion !== null && ` (v${data.baselineVersion})`}
                </div>
                <p className="text-sm">
                  {data.baselineExplanation ?? "No version is currently in force."}
                </p>
              </div>
              <div className="border-primary/30 bg-primary/5 rounded-lg border p-3">
                <div className="text-muted-foreground mb-1 text-xs font-medium">
                  Proposed (v{data.version})
                </div>
                <p className="text-sm">{data.explanation}</p>
              </div>
            </div>

            <div>
              <div className="text-muted-foreground mb-1.5 text-xs font-medium">
                Difference
              </div>
              {data.diff.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No differences were detected.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.diff.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span className="bg-primary mt-[7px] size-1 shrink-0 rounded-full" />
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Collapsible>
              <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs">
                <ChevronDown className="size-3.5" />
                json_logic
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <pre className="bg-muted overflow-x-auto rounded-lg p-3 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(data.jsonLogic, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Independent review</CardTitle>
            <CardDescription>
              A challenger agent checked the draft against the source paragraph.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.challenger ? (
              <>
                <div className="flex items-center gap-2">
                  {data.challenger.verdict === "pass" ? (
                    <ShieldCheck className="size-5 text-emerald-600" />
                  ) : (
                    <ShieldAlert className="size-5 text-red-600" />
                  )}
                  <StatusBadge status={data.challenger.verdict} />
                  {data.challenger.severity && (
                    <span className="text-muted-foreground text-xs">
                      severity {data.challenger.severity}
                    </span>
                  )}
                </div>
                <ul className="space-y-1.5 text-sm">
                  {data.challenger.reasons.map((reason) => (
                    <li key={reason} className="text-muted-foreground">
                      {reason}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                No challenger verdict was recorded for this version.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Backtest</CardTitle>
            <CardDescription>
              {data.backtest
                ? `Replayed over ${data.backtest.totalTxns.toLocaleString("en-US")} stored transactions.`
                : "No backtest has been run for this version."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.backtest ? (
              <div className="grid gap-6 sm:grid-cols-2">
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <BarChart data={chartData} margin={{ top: 20 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                    />
                    <YAxis tickLine={false} axisLine={false} width={40} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="alerts" radius={6}>
                      <LabelList
                        dataKey="alerts"
                        position="top"
                        className="fill-foreground text-xs"
                      />
                    </Bar>
                  </BarChart>
                </ChartContainer>

                <dl className="grid grid-cols-2 gap-4 self-center text-sm">
                  <Metric
                    label="Alerts now"
                    value={data.backtest.oldAlerts.toLocaleString("en-US")}
                  />
                  <Metric
                    label="Alerts proposed"
                    value={data.backtest.newAlerts.toLocaleString("en-US")}
                  />
                  <Metric
                    label="Change"
                    value={`${added >= 0 ? "+" : ""}${added.toLocaleString("en-US")}`}
                  />
                  <Metric
                    label="Customers affected"
                    value={data.backtest.customersAffected.toLocaleString("en-US")}
                  />
                </dl>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Backtest results appear here once the pipeline has run.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Impact</CardTitle>
              {data.impact && <StatusBadge status={data.impact.riskLevel} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.impact ? (
              <>
                <p className="text-sm leading-relaxed">{data.impact.summary}</p>
                <ul className="space-y-1 text-sm">
                  {data.impact.drivers.map((driver) => (
                    <li key={driver} className="text-muted-foreground flex gap-2">
                      <span className="bg-muted-foreground/40 mt-[7px] size-1 shrink-0 rounded-full" />
                      {driver}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                No impact summary was recorded.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {data.approval && (
        <Alert>
          <AlertDescription>
            <span className="font-medium capitalize">
              {data.approval.decision}
            </span>{" "}
            by {data.approval.checkerName ?? "a head of compliance"}
            {data.approval.comment ? ` — “${data.approval.comment}”` : ""}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Decision</CardTitle>
          <CardDescription>
            Approving records the decision; it does not deploy the rule.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <StatusBadge status={data.status} />

          {canSubmit && data.status === "draft" && (
            <Button onClick={onSubmit} disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Submit for approval
            </Button>
          )}

          {canDecide && data.status === "submitted" && !isOwnSubmission && (
            <>
              <Button onClick={() => setDecision("approved")} disabled={pending}>
                Approve
              </Button>
              <Button
                variant="outline"
                onClick={() => setDecision("rejected")}
                disabled={pending}
              >
                Reject
              </Button>
            </>
          )}

          {canDecide && data.status === "submitted" && isOwnSubmission && (
            <p className="text-muted-foreground text-sm">
              You submitted this draft, so it needs a different approver.
            </p>
          )}

          {data.submittedByName && (
            <span className="text-muted-foreground text-xs">
              submitted by {data.submittedByName}
            </span>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={decision !== null}
        onOpenChange={(open) => !open && setDecision(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision === "approved" ? "Approve" : "Reject"} {data.ruleCode} v
              {data.version}
            </DialogTitle>
            <DialogDescription>
              A comment is required and is kept in the audit trail.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={4}
              placeholder="Why are you making this decision?"
              aria-invalid={Boolean(commentError)}
            />
            {commentError && (
              <p className="text-destructive text-xs">{commentError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button onClick={onDecide} disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Confirm {decision === "approved" ? "approval" : "rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-heading text-xl font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  );
}

