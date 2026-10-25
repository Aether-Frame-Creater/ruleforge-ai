"use client";

import { Check, Loader2, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
  decideObligationAction,
  editObligationAction,
} from "@/lib/actions/circular-actions";

export interface ObligationRow {
  id: string;
  summary: string;
  obligationType: string;
  deadline: string | null;
  status: string;
  chunkId: string | null;
  paragraphRef: string | null;
  chunkText: string | null;
  reviewedByName: string | null;
  /** The exact text the quote check matched in the source paragraph. */
  quote: string | null;
}

export interface ParagraphRow {
  id: string;
  paragraphRef: string | null;
  text: string;
}

/**
 * Obligations beside the paragraphs they came from.
 *
 * Selecting an obligation scrolls to and highlights its source paragraph, with
 * the verified quote marked inside it. The quote is the whole point of the
 * extraction step, so the reviewer should never have to hunt for it.
 */
export function ObligationsPanel({
  obligations,
  paragraphs,
  canReview,
}: {
  obligations: ObligationRow[];
  paragraphs: ParagraphRow[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(
    obligations[0]?.id ?? null,
  );
  const [editing, setEditing] = useState<ObligationRow | null>(null);
  const [draftSummary, setDraftSummary] = useState("");
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const selectedObligation = obligations.find((o) => o.id === selected) ?? null;
  const highlightedChunk = selectedObligation?.chunkId ?? null;

  function decide(obligation: ObligationRow, decision: "confirmed" | "rejected") {
    setBusyId(obligation.id);
    startTransition(async () => {
      const result = await decideObligationAction({
        obligationId: obligation.id,
        decision,
      });
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Obligation ${decision}`);
      router.refresh();
    });
  }

  function saveEdit() {
    if (!editing) return;
    startTransition(async () => {
      const result = await editObligationAction({
        obligationId: editing.id,
        summary: draftSummary,
      });
      if (!result.ok) {
        toast.error(result.fieldErrors?.summary?.[0] ?? result.error);
        return;
      }
      toast.success("Summary updated");
      setEditing(null);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Obligations ({obligations.length})
          </CardTitle>
          <CardDescription>
            Each one cites a paragraph and a quote that was verified against the
            source text in code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {obligations.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No obligations were extracted from this circular.
            </p>
          ) : (
            <ul className="space-y-3">
              {obligations.map((obligation) => {
                const active = obligation.id === selected;
                return (
                  <li key={obligation.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(obligation.id)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        active
                          ? "border-primary/40 bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {obligation.paragraphRef && (
                          <span className="bg-muted rounded px-1.5 py-0.5 font-mono text-[11px]">
                            {obligation.paragraphRef}
                          </span>
                        )}
                        <StatusBadge status={obligation.status} />
                        <span className="text-muted-foreground text-xs">
                          {obligation.obligationType}
                        </span>
                        {obligation.deadline && (
                          <span className="text-muted-foreground text-xs">
                            due {obligation.deadline}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-sm">{obligation.summary}</p>
                      {obligation.reviewedByName && (
                        <p className="text-muted-foreground mt-1 text-xs">
                          reviewed by {obligation.reviewedByName}
                        </p>
                      )}
                    </button>

                    {canReview && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending || obligation.status === "confirmed"}
                          onClick={() => decide(obligation, "confirmed")}
                        >
                          {busyId === obligation.id ? (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          ) : (
                            <Check className="mr-1.5 size-3.5" />
                          )}
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => {
                            setEditing(obligation);
                            setDraftSummary(obligation.summary);
                          }}
                        >
                          <Pencil className="mr-1.5 size-3.5" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending || obligation.status === "rejected"}
                          onClick={() => decide(obligation, "rejected")}
                        >
                          <X className="mr-1.5 size-3.5" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Circular text ({paragraphs.length} paragraphs)
          </CardTitle>
          <CardDescription>
            {selectedObligation
              ? "The highlighted paragraph is the source of the selected obligation."
              : "Select an obligation to see where it came from."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {paragraphs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              The circular has not been split into paragraphs yet.
            </p>
          ) : (
            <ol className="space-y-3">
              {paragraphs.map((paragraph) => {
                const highlighted = paragraph.id === highlightedChunk;
                return (
                  <li
                    key={paragraph.id}
                    className={`rounded-lg border p-3 transition-colors ${
                      highlighted
                        ? "border-primary/40 bg-primary/5"
                        : "border-transparent"
                    }`}
                  >
                    <div className="text-muted-foreground mb-1 font-mono text-[11px]">
                      {paragraph.paragraphRef ?? "—"}
                    </div>
                    <p className="text-sm leading-relaxed">
                      {highlighted && selectedObligation?.quote ? (
                        <HighlightedQuote
                          text={paragraph.text}
                          quote={selectedObligation.quote}
                        />
                      ) : (
                        paragraph.text
                      )}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={() => setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit the obligation summary</DialogTitle>
            <DialogDescription>
              The original wording is kept in the audit trail. The quote and the
              source paragraph are not editable.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={draftSummary}
            onChange={(event) => setDraftSummary(event.target.value)}
            rows={4}
            placeholder="One plain sentence describing what the bank must do."
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The paragraph with the obligation's quote marked.
 *
 * The quote comes from the audit entry written at extraction time, so what is
 * highlighted is exactly the text the verification step matched — not a
 * re-derived approximation of it.
 */
function HighlightedQuote({ text, quote }: { text: string; quote: string }) {
  const index = text.toLowerCase().indexOf(quote.toLowerCase());
  if (index === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, index)}
      <mark className="dark:text-foreground rounded bg-amber-200/70 px-0.5 dark:bg-amber-400/25">
        {text.slice(index, index + quote.length)}
      </mark>
      {text.slice(index + quote.length)}
    </>
  );
}
