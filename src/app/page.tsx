import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-16">
      <Badge variant="secondary" className="w-fit">
        Scaffold
      </Badge>
      <h1 className="font-heading text-3xl font-semibold tracking-tight">
        RuleForge AI
      </h1>
      <p className="text-muted-foreground">
        Multi-agent regulatory compliance for banks: read circulars, extract
        obligations, draft rule changes, backtest them against synthetic
        transactions, and gate deployment behind human approval.
      </p>
      <p className="text-muted-foreground text-sm">
        Nothing is wired up yet — this is the project scaffold.
      </p>
    </main>
  );
}
