"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { startShadowAction } from "@/lib/actions/deploy-actions";

export interface RolloutCardView {
  id: string;
  version: number;
  status: string;
  rolloutPercent: number;
  changeSummary: string | null;
  explanation: string;
  shadowStartedAt: string | null;
  liveAt: string | null;
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  ruleCategory: string;
  shadowRunCount: number;
  latestAlertRateChangePct: string | null;
}

export function RolloutColumn({
  title,
  description,
  cards,
  canAct,
}: {
  title: string;
  description: string;
  cards: RolloutCardView[];
  canAct: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {title}
          <span className="text-muted-foreground tabular-nums">
            {cards.length}
          </span>
        </h2>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>

      {cards.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-xs">
          Nothing here
        </div>
      ) : (
        cards.map((card) => (
          <DeploymentCard key={card.id} card={card} canAct={canAct} />
        ))
      )}
    </section>
  );
}

function DeploymentCard({
  card,
  canAct,
}: {
  card: RolloutCardView;
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onStartShadow() {
    setPending(true);
    const result = await startShadowAction({ ruleVersionId: card.id });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${card.ruleCode} v${card.version} is now in shadow`);
    router.refresh();
  }

  const change =
    card.latestAlertRateChangePct === null
      ? null
      : Number(card.latestAlertRateChangePct);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-mono text-sm">
            {card.ruleCode} v{card.version}
          </CardTitle>
          <StatusBadge status={card.status} />
          {card.status === "shadow" && card.rolloutPercent > 0 && (
            <span className="text-muted-foreground text-xs tabular-nums">
              {card.rolloutPercent}% of customers
            </span>
          )}
        </div>
        <CardDescription>{card.ruleName}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm">{card.explanation}</p>

        {card.changeSummary && (
          <p className="text-muted-foreground text-xs">{card.changeSummary}</p>
        )}

        {card.status === "shadow" && (
          <p className="text-muted-foreground text-xs">
            {card.shadowRunCount === 0
              ? "No shadow comparison yet — run one before rolling out."
              : `${card.shadowRunCount} shadow run${card.shadowRunCount === 1 ? "" : "s"}` +
                (change === null
                  ? ""
                  : `, alerts ${change >= 0 ? "+" : ""}${change.toFixed(0)}% vs live`)}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {canAct && card.status === "approved" && (
            <Button size="sm" onClick={onStartShadow} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              Start shadow
            </Button>
          )}

          {(card.status === "shadow" || card.status === "live") && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/rollout/${card.id}`}>
                {card.status === "shadow" ? "Compare and roll out" : "Open"}
              </Link>
            </Button>
          )}

          {!canAct && card.status === "approved" && (
            <span className="text-muted-foreground text-xs">
              Waiting on operations
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
