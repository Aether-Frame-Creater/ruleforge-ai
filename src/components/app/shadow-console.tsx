"use client";

import { AlertTriangle, Loader2, PlayCircle, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  rollbackAction,
  runShadowComparisonAction,
  setRolloutAction,
} from "@/lib/actions/deploy-actions";

export interface ShadowRunView {
  id: string;
  txnsEvaluated: number;
  liveAlerts: number;
  shadowAlerts: number;
  alertsOnlyLive: number;
  alertsOnlyShadow: number;
  alertRateChangePct: string | null;
  createdAt: string;
  createdByName: string | null;
  simulated: boolean;
}

export interface ShadowConsoleData {
  ruleVersionId: string;
  ruleId: string;
  ruleCode: string;
  version: number;
  status: string;
  rolloutPercent: number;
  explanation: string;
  baselineExplanation: string | null;
  runs: ShadowRunView[];
}

const chartConfig = {
  alerts: { label: "Alerts" },
  live: { label: "Live rule", color: "var(--chart-2)" },
  shadow: { label: "Shadow rule", color: "var(--chart-1)" },
} satisfies ChartConfig;

const STAGES = [10, 50, 100] as const;

export function ShadowConsole({
  data,
  canAct,
}: {
  data: ShadowConsoleData;
  canAct: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const [guardrail, setGuardrail] = useState<{
    percent: number;
    message: string;
  } | null>(null);
  const [acknowledgement, setAcknowledgement] = useState("");

  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const latest = data.runs[0] ?? null;
  const change =
    latest?.alertRateChangePct === null || latest === null
      ? null
      : Number(latest.alertRateChangePct);

  async function onSimulate() {
    setBusy("simulate");
    const result = await runShadowComparisonAction({
      ruleVersionId: data.ruleVersionId,
      simulate: true,
    });
    setBusy(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      `Simulated day compared: ${result.data.liveAlerts} live vs ${result.data.shadowAlerts} shadow alerts`,
    );
    router.refresh();
  }

  async function onCompareReal() {
    setBusy("compare");
    const result = await runShadowComparisonAction({
      ruleVersionId: data.ruleVersionId,
      simulate: false,
    });
    setBusy(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      `Compared ${result.data.txnsEvaluated.toLocaleString("en-US")} transactions`,
    );
    router.refresh();
  }

  async function onRollout(percent: number, confirmation?: string) {
    setBusy(`rollout-${percent}`);
    const result = await setRolloutAction({
      ruleVersionId: data.ruleVersionId,
      percent,
      guardrailAcknowledgement: confirmation,
    });
    setBusy(null);

    if (!result.ok) {
      // A guardrail refusal comes back with a field error; everything else is
      // a plain failure.
      if (result.fieldErrors?.guardrailAcknowledgement) {
        setGuardrail({ percent, message: result.error });
        return;
      }
      toast.error(result.error);
      return;
    }

    setGuardrail(null);
    setAcknowledgement("");
    toast.success(
      percent === 100
        ? `${data.ruleCode} v${data.version} is now live`
        : `Rolled out to ${percent}% of customers`,
    );
    router.refresh();
  }

  async function onRollback() {
    setReasonError(null);
    setBusy("rollback");
    const result = await rollbackAction({ ruleId: data.ruleId, reason });
    setBusy(null);

    if (!result.ok) {
      setReasonError(result.fieldErrors?.reason?.[0] ?? result.error);
      return;
    }
    toast.success(`Rolled back — v${result.data.restoredVersion} is live again`);
    setRollbackOpen(false);
    setReason("");
    router.refresh();
  }

  const chartData = latest
    ? [
        { name: "Live rule", alerts: latest.liveAlerts, fill: "var(--color-live)" },
        {
          name: "Shadow rule",
          alerts: latest.shadowAlerts,
          fill: "var(--color-shadow)",
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Live versus shadow</CardTitle>
            <CardDescription>
              {latest
                ? `${latest.txnsEvaluated.toLocaleString("en-US")} transactions evaluated${
                    latest.simulated ? " (simulated day)" : ""
                  }, ${new Date(latest.createdAt).toLocaleString("en-GB")}`
                : "No comparison has been run yet."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {latest ? (
              <div className="grid gap-6 sm:grid-cols-2">
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <BarChart data={chartData} margin={{ top: 20 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
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
                    label="Only in live"
                    value={latest.alertsOnlyLive.toLocaleString("en-US")}
                    hint="The shadow rule would miss these"
                  />
                  <Metric
                    label="Only in shadow"
                    value={latest.alertsOnlyShadow.toLocaleString("en-US")}
                    hint="New alerts the shadow rule adds"
                  />
                  <Metric
                    label="Alert rate change"
                    value={
                      change === null
                        ? "n/a"
                        : `${change >= 0 ? "+" : ""}${change.toFixed(0)}%`
                    }
                  />
                  <Metric
                    label="Rollout"
                    value={`${data.rolloutPercent}%`}
                    hint="Share of customers on the new rule"
                  />
                </dl>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Run a comparison to see what this version would have done.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">The change</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="text-muted-foreground mb-1 text-xs font-medium">
                Live now
              </div>
              <p>{data.baselineExplanation ?? "No rule is currently in force."}</p>
            </div>
            <div className="border-primary/30 bg-primary/5 rounded-lg border p-3">
              <div className="text-muted-foreground mb-1 text-xs font-medium">
                Shadow (v{data.version})
              </div>
              <p>{data.explanation}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {change !== null && change > 150 && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            The shadow rule raises alerts by {change.toFixed(0)}% against the
            live rule, above the 150% guardrail. A rollout needs a typed reason.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions</CardTitle>
          <CardDescription>
            {canAct
              ? "A shadow rule raises no alerts. It takes effect for customers only at 100%."
              : "Only the operations role can act here."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <StatusBadge status={data.status} />

          {canAct && data.status === "shadow" && (
            <>
              <Button variant="outline" size="sm" onClick={onSimulate} disabled={busy !== null}>
                {busy === "simulate" ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <PlayCircle className="mr-1.5 size-3.5" />
                )}
                Simulate a day of transactions
              </Button>

              <Button variant="outline" size="sm" onClick={onCompareReal} disabled={busy !== null}>
                {busy === "compare" && (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                )}
                Compare last 30 days
              </Button>

              {STAGES.map((percent) => (
                <Button
                  key={percent}
                  size="sm"
                  variant={percent === 100 ? "default" : "outline"}
                  disabled={busy !== null || data.runs.length === 0}
                  onClick={() => onRollout(percent)}
                >
                  {busy === `rollout-${percent}` && (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  )}
                  {percent === 100 ? "Go live (100%)" : `Roll out ${percent}%`}
                </Button>
              ))}
            </>
          )}

          {canAct && data.status === "live" && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setRollbackOpen(true)}
              disabled={busy !== null}
            >
              <RotateCcw className="mr-1.5 size-3.5" />
              Roll back
            </Button>
          )}

          {canAct && data.status === "shadow" && data.runs.length === 0 && (
            <span className="text-muted-foreground text-xs">
              Run a comparison before rolling out.
            </span>
          )}
        </CardContent>
      </Card>

      {data.runs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shadow run history</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {data.runs.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                >
                  <span className="tabular-nums">
                    {run.liveAlerts} → {run.shadowAlerts}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    +{run.alertsOnlyShadow} / −{run.alertsOnlyLive}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {run.txnsEvaluated.toLocaleString("en-US")} txns
                    {run.simulated ? " (simulated)" : ""}
                  </span>
                  <span className="text-muted-foreground ml-auto text-xs">
                    {run.createdByName ?? "—"} ·{" "}
                    {new Date(run.createdAt).toLocaleString("en-GB")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Guardrail confirmation */}
      <Dialog
        open={guardrail !== null}
        onOpenChange={(open) => !open && setGuardrail(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm a large increase in alerts</DialogTitle>
            <DialogDescription>{guardrail?.message}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={acknowledgement}
            onChange={(event) => setAcknowledgement(event.target.value)}
            rows={3}
            placeholder="Why is this increase acceptable?"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setGuardrail(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                guardrail && onRollout(guardrail.percent, acknowledgement)
              }
              disabled={busy !== null || acknowledgement.trim().length < 10}
            >
              Proceed with the rollout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback */}
      <Dialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Roll back {data.ruleCode} v{data.version}
            </DialogTitle>
            <DialogDescription>
              The previous version is restored immediately. A reason is required
              and is kept in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="What went wrong?"
              aria-invalid={Boolean(reasonError)}
            />
            {reasonError && (
              <p className="text-destructive text-xs">{reasonError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onRollback}
              disabled={busy !== null}
            >
              {busy === "rollback" && (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              )}
              Roll back now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-heading text-xl font-semibold tabular-nums">
        {value}
      </dd>
      {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
    </div>
  );
}
