import { Rocket } from "lucide-react";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { RolloutColumn } from "@/components/app/rollout-board";
import { requireRoleForPage } from "@/lib/auth/guards";
import { listRolloutBoard } from "@/lib/queries";
import { explainRule } from "@/rules/engine";

export const instant = false;

export const metadata = { title: "Rollout — RuleForge AI" };

function safeExplain(logic: unknown): string {
  try {
    return explainRule(logic);
  } catch {
    return "This rule cannot be rendered in plain English.";
  }
}

export default async function RolloutPage() {
  // Ops act; head and auditor may look. Enforced here, and again inside every
  // deployment function — hiding a button is not access control.
  const user = await requireRoleForPage(["ops", "head", "auditor"], "/rollout");
  const board = await listRolloutBoard();
  const canAct = user.role === "ops";

  const total =
    board.approved.length + board.shadow.length + board.live.length;

  return (
    <>
      <PageHeader
        title="Rollout"
        description={
          canAct
            ? "Move approved rules into shadow, widen the rollout, and roll back."
            : "Where each rule stands. Only the operations role can act here."
        }
      />

      {total === 0 ? (
        <EmptyState
          icon={Rocket}
          title="Nothing to deploy"
          description="Approved rule versions appear here once a head of compliance signs them off."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <RolloutColumn
            title="Approved"
            description="Signed off, not yet observed."
            cards={board.approved.map((card) => ({
              ...card,
              explanation: safeExplain(card.jsonLogic),
              shadowStartedAt: card.shadowStartedAt?.toISOString() ?? null,
              liveAt: card.liveAt?.toISOString() ?? null,
            }))}
            canAct={canAct}
          />
          <RolloutColumn
            title="Shadow"
            description="Evaluated alongside the live rule. Raises no alerts."
            cards={board.shadow.map((card) => ({
              ...card,
              explanation: safeExplain(card.jsonLogic),
              shadowStartedAt: card.shadowStartedAt?.toISOString() ?? null,
              liveAt: card.liveAt?.toISOString() ?? null,
            }))}
            canAct={canAct}
          />
          <RolloutColumn
            title="Live"
            description="In force for customers now."
            cards={board.live.map((card) => ({
              ...card,
              explanation: safeExplain(card.jsonLogic),
              shadowStartedAt: card.shadowStartedAt?.toISOString() ?? null,
              liveAt: card.liveAt?.toISOString() ?? null,
            }))}
            canAct={canAct}
          />
        </div>
      )}

      <p className="text-muted-foreground mt-6 text-xs">
        A shadow rule is only ever evaluated: it raises no alert and changes
        nothing for any customer until it reaches 100% and goes live.{" "}
        <Link href="/rules" className="underline">
          See every rule and its history
        </Link>
      </p>
    </>
  );
}
