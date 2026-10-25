import {
  ClipboardCheck,
  FileText,
  ScrollText,
  Scale,
} from "lucide-react";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/guards";
import { dashboardSummary } from "@/lib/queries";

export const instant = false;

export const metadata = { title: "Dashboard — RuleForge AI" };

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const summary = await dashboardSummary();

  const stats = [
    {
      label: "Circulars",
      value: summary.circularTotal,
      hint: `${summary.circularsByStatus.find((s) => s.status === "review")?.n ?? 0} awaiting review`,
      icon: FileText,
      href: "/circulars",
    },
    {
      label: "Drafts awaiting approval",
      value: summary.awaitingApproval,
      hint:
        summary.awaitingApproval > 0
          ? "A head needs to decide"
          : "Nothing submitted",
      icon: ClipboardCheck,
      href: can(user.role, "decideDraft") ? "/approvals" : "/rules",
    },
    {
      label: "Live rules",
      value: summary.liveRules,
      hint: "Currently in force",
      icon: Scale,
      href: "/rules",
    },
    {
      label: "Open drafts",
      value: summary.openDrafts,
      hint: "Not yet submitted",
      icon: ScrollText,
      href: "/rules",
    },
  ];

  return (
    <>
      <PageHeader
        title={`Good day, ${user.name.split(" ")[0]}`}
        description="Where regulatory change stands right now."
        actions={
          can(user.role, "uploadCircular") ? (
            <Button asChild>
              <Link href="/circulars">Upload a circular</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="group">
            <Card className="h-full transition-colors group-hover:border-foreground/20">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription>{stat.label}</CardDescription>
                  <stat.icon className="text-muted-foreground size-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="font-heading text-3xl font-semibold tabular-nums">
                  {stat.value}
                </div>
                <p className="text-muted-foreground mt-1 text-xs">{stat.hint}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Circulars by status</CardTitle>
            <CardDescription>
              Every circular the system has ingested.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {summary.circularsByStatus.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No circulars yet.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {summary.circularsByStatus
                  .slice()
                  .sort((a, b) => b.n - a.n)
                  .map((row) => (
                    <li
                      key={row.status}
                      className="flex items-center justify-between gap-3"
                    >
                      <StatusBadge status={row.status} />
                      <span className="text-sm font-medium tabular-nums">
                        {row.n}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
            <CardDescription>
              The last 10 entries in the append-only audit trail.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {summary.recentAudit.length === 0 ? (
              <EmptyState
                icon={ScrollText}
                title="Nothing has happened yet"
                description="Activity appears here as soon as a circular is uploaded."
              />
            ) : (
              <ul className="divide-y text-sm">
                {summary.recentAudit.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 first:pt-0 last:pb-0"
                  >
                    <code className="text-xs font-medium">{entry.action}</code>
                    <span className="text-muted-foreground text-xs">
                      {entry.actor}
                    </span>
                    <span className="text-muted-foreground ml-auto text-xs whitespace-nowrap">
                      {timeAgo(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
