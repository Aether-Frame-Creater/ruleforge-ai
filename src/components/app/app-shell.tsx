"use client";

import {
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Scale,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/app/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { signOutAction } from "@/lib/actions/auth-actions";
import type { UserRole } from "@/lib/auth";

export interface ShellUser {
  name: string;
  email: string;
  role: UserRole;
  roleLabel: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Roles that may see the link. Server guards enforce the same list. */
  roles: readonly UserRole[];
  description: string;
}

const NAV: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["officer", "head", "ops", "auditor"],
    description: "Status at a glance",
  },
  {
    href: "/circulars",
    label: "Circulars",
    icon: FileText,
    roles: ["officer", "head", "ops", "auditor"],
    description: "Uploaded regulatory circulars",
  },
  {
    href: "/approvals",
    label: "Approvals",
    icon: ClipboardCheck,
    roles: ["head", "auditor"],
    description: "Drafts awaiting a decision",
  },
  {
    href: "/rules",
    label: "Rules",
    icon: Scale,
    roles: ["officer", "head", "ops", "auditor"],
    description: "Live rules and version history",
  },
  {
    href: "/audit",
    label: "Audit trail",
    icon: ScrollText,
    roles: ["head", "auditor"],
    description: "Every recorded action",
  },
];

const ROLE_BADGE: Record<UserRole, string> = {
  officer: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20",
  head: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20",
  ops: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
  auditor:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
};

export function AppShell({
  user,
  children,
}: {
  user: ShellUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const visible = NAV.filter((item) => item.roles.includes(user.role));

  async function onSignOut() {
    setPending(true);
    const result = await signOutAction();
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Signed out");
    // Outside a transition, for the same reason as sign-in.
    router.push("/login");
    router.refresh();
  }

  return (
    // The sidebar renders a tooltip per item when collapsed, and those need a
    // provider above them.
    <TooltipProvider delayDuration={300}>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <div className="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center rounded-md text-sm font-semibold">
                R
              </div>
              <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                <div className="truncate text-sm font-semibold">
                  RuleForge AI
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  Regulatory change
                </div>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visible.map((item) => {
                    const active =
                      pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.description}
                        >
                          <Link href={item.href}>
                            <item.icon />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <div className="group-data-[collapsible=icon]:hidden">
              <div className="flex items-start gap-2 px-2 py-1.5">
                <div className="bg-muted grid size-8 shrink-0 place-items-center rounded-full text-xs font-medium">
                  {user.name
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {user.name}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {user.email}
                  </div>
                </div>
              </div>
              <div className="px-2 pb-2">
                <Badge
                  variant="outline"
                  className={`w-full justify-center ${ROLE_BADGE[user.role]}`}
                >
                  <ShieldCheck className="mr-1 size-3" />
                  {user.roleLabel}
                </Badge>
              </div>
            </div>

            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={onSignOut}
                  disabled={pending}
                  tooltip="Sign out"
                >
                  <LogOut />
                  <span>{pending ? "Signing out…" : "Sign out"}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <header className="bg-background/95 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <div className="flex-1" />
            <Badge variant="outline" className={ROLE_BADGE[user.role]}>
              {user.roleLabel}
            </Badge>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={onSignOut}
              disabled={pending}
              className="hidden sm:inline-flex"
            >
              <LogOut className="mr-1.5 size-4" />
              Sign out
            </Button>
          </header>

          <main className="flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
