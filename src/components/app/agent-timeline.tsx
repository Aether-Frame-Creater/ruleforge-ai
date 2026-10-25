"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { StatusBadge } from "@/components/app/status-badge";
import { continueCircularAction } from "@/lib/actions/circular-actions";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface AgentRun {
  id: string;
  agentName: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  model: string | null;
  mode: string | null;
  fromCache: boolean | null;
  envelopeIn: unknown;
  envelopeOut: unknown;
}

interface Envelope {
  from: string;
  to: string;
  type: string;
  timestamp: string;
}

const POLL_MS = 2_000;

/**
 * How many times the client will ask the server to continue a paused run.
 *
 * A serverless invocation can only do so much, so a long pipeline finishes
 * over several. The cap stops a genuinely broken run from being nudged for
 * ever — after it, the run is reported as stalled for a human to look at.
 */
const MAX_CONTINUES = 12;

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "from" in value &&
    "to" in value &&
    "type" in value
  );
}

const ENVELOPE_TONE: Record<string, string> = {
  request: "bg-muted text-muted-foreground border-transparent",
  finding: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20",
  result:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  objection: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20",
};

export function AgentTimeline({
  circularId,
  initialRuns,
  initialSettled,
}: {
  circularId: string;
  initialRuns: AgentRun[];
  initialSettled: boolean;
}) {
  const router = useRouter();
  const [runs, setRuns] = useState(initialRuns);
  const [settled, setSettled] = useState(initialSettled);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const continues = useRef(0);

  useEffect(() => {
    if (settled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const response = await fetch(`/api/circulars/${circularId}/runs`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const data = (await response.json()) as {
          runs: AgentRun[];
          settled: boolean;
          stalled?: boolean;
          idleSeconds?: number;
        };
        if (cancelled) return;

        setRuns(data.runs);
        setError(null);

        // The previous slice ran out of invocation time. Ask for another.
        if (data.stalled && !data.settled) {
          if (continues.current < MAX_CONTINUES) {
            continues.current += 1;
            setNotice(
              `Resuming — step ${continues.current} of up to ${MAX_CONTINUES}.`,
            );
            await continueCircularAction({ circularId });
          } else {
            setNotice(
              `This run has been idle for ${data.idleSeconds ?? 0}s and has stopped making progress. ` +
                "It may have failed; check the audit trail.",
            );
            setSettled(true);
            router.refresh();
            return;
          }
        }

        if (data.settled) {
          setSettled(true);
          // The rest of the page was rendered on the server before the agents
          // finished, so it needs re-fetching once they have.
          router.refresh();
          return;
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? `Could not refresh the timeline (${cause.message}). Retrying…`
              : "Could not refresh the timeline. Retrying…",
          );
        }
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }

    timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [circularId, settled, router]);

  const envelopes = runs
    .flatMap((run) => [run.envelopeIn, run.envelopeOut])
    .filter(isEnvelope)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Agent pipeline</CardTitle>
            <CardDescription>
              {settled
                ? `${runs.length} step${runs.length === 1 ? "" : "s"} recorded in agent_runs.`
                : "Running — refreshing every 2 seconds."}
            </CardDescription>
          </div>
          {!settled && (
            <Badge variant="outline" className="gap-1.5">
              <Loader2 className="size-3 animate-spin" />
              live
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <p className="text-muted-foreground text-xs">{error}</p>}
        {notice && <p className="text-muted-foreground text-xs">{notice}</p>}

        {runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {settled
              ? "No agent runs were recorded for this circular."
              : "Waiting for the first agent to start…"}
          </p>
        ) : (
          <ol className="space-y-0">
            {runs.map((run, index) => (
              <li key={run.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <StepIcon status={run.status} />
                  {index < runs.length - 1 && (
                    <div className="bg-border my-1 w-px flex-1" />
                  )}
                </div>

                <div className="flex-1 pb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-sm font-medium">{run.agentName}</code>
                    <StatusBadge status={run.status} />
                    {run.durationMs !== null && (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {(run.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                    {run.fromCache && (
                      <Badge variant="outline" className="text-[10px]">
                        cached
                      </Badge>
                    )}
                  </div>

                  <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs">
                    {run.model && <span>{run.model}</span>}
                    {run.mode && <span>mode: {run.mode}</span>}
                  </div>

                  {run.error && (
                    <p className="text-destructive mt-1 text-xs">{run.error}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        {envelopes.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs">
              <ChevronDown className="size-3.5" />
              A2A envelopes ({envelopes.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <ul className="space-y-1 font-mono text-[11px]">
                {envelopes.map((envelope, index) => (
                  <li
                    key={`${envelope.timestamp}-${index}`}
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    <span className="text-muted-foreground tabular-nums">
                      {envelope.timestamp.slice(11, 19)}
                    </span>
                    <span>{envelope.from}</span>
                    <span className="text-muted-foreground">→</span>
                    <span>{envelope.to}</span>
                    <Badge
                      variant="outline"
                      className={`px-1.5 py-0 text-[10px] ${
                        ENVELOPE_TONE[envelope.type] ?? ""
                      }`}
                    >
                      {envelope.type}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

function StepIcon({ status }: { status: AgentRun["status"] }) {
  const className = "size-4 shrink-0";
  if (status === "succeeded")
    return <CheckCircle2 className={`${className} text-emerald-600`} />;
  if (status === "failed")
    return <AlertCircle className={`${className} text-red-600`} />;
  if (status === "running")
    return <Loader2 className={`${className} animate-spin text-blue-600`} />;
  return <Circle className={`${className} text-muted-foreground`} />;
}
