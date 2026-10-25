import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Colour carries meaning here, so it is defined once: green for settled and
 * good, amber for waiting on a person, red for stopped or refused, blue for
 * in flight. Every status in the system maps into that vocabulary.
 */
const TONES = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  info: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20",
  pending:
    "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  bad: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20",
} as const;

type Tone = keyof typeof TONES;

const STATUS_TONES: Record<string, Tone> = {
  // circulars
  uploaded: "neutral",
  analysing: "info",
  not_applicable: "neutral",
  review: "pending",
  approved: "good",
  rejected: "bad",
  deployed: "good",
  // rule versions
  draft: "neutral",
  submitted: "pending",
  shadow: "info",
  live: "good",
  rolled_back: "bad",
  // obligations
  extracted: "neutral",
  confirmed: "good",
  edited: "info",
  // agent runs
  queued: "neutral",
  running: "info",
  succeeded: "good",
  failed: "bad",
  // risk
  low: "good",
  medium: "pending",
  high: "bad",
  // challenger
  pass: "good",
  fail: "bad",
};

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const tone = STATUS_TONES[status] ?? "neutral";
  return (
    <Badge variant="outline" className={cn(TONES[tone], className)}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
