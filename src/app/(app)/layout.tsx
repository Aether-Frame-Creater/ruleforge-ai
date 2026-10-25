import { AppShell } from "@/components/app/app-shell";
import { requireUser, ROLE_LABELS } from "@/lib/auth/guards";

/**
 * Per-user and always current: this route reads the session and live database
 * state, so it is never prerendered.
 */
export const instant = false;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Every page inside this group is behind a session. Individual pages add
  // their own role checks on top; this only establishes who is asking.
  const user = await requireUser();

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        roleLabel: ROLE_LABELS[user.role],
      }}
    >
      {children}
    </AppShell>
  );
}
