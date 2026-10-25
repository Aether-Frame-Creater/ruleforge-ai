import { redirect } from "next/navigation";

import { LoginForm } from "@/components/app/login-form";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { USER_ROLES, type UserRole } from "@/lib/auth";
import { optionalUser, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/auth/guards";
import { env } from "@/lib/env";

/**
 * Per-user and always current: this route reads the session and live database
 * state, so it is never prerendered.
 */
export const instant = false;

export const metadata = { title: "Sign in — RuleForge AI" };

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const user = await optionalUser();
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/dashboard";

  if (user) redirect(next);

  // The demo accounts are only ever named on the server, and only when demo
  // mode is on. The password never reaches the browser at all.
  const demoUsers = env.DEMO_MODE
    ? USER_ROLES.map((role: UserRole) => ({
        role,
        label: ROLE_LABELS[role],
        description: ROLE_DESCRIPTIONS[role],
        email: `${role}@ruleforge.demo`,
      }))
    : [];

  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-10 px-6 py-12 lg:flex-row lg:items-stretch lg:gap-16">
        <div className="flex max-w-md flex-col justify-center gap-5">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary text-primary-foreground grid size-9 place-items-center rounded-md font-semibold">
              R
            </div>
            <span className="text-lg font-semibold tracking-tight">
              RuleForge AI
            </span>
          </div>

          <h1 className="font-heading text-3xl leading-tight font-semibold tracking-tight text-balance">
            Regulatory change, from circular to approved rule.
          </h1>

          <p className="text-muted-foreground text-sm leading-relaxed">
            Agents read the circular, extract obligations with a verified quote
            from the source paragraph, draft the rule change and backtest it.
            Every draft stops at a human for maker-checker approval — nothing
            deploys itself.
          </p>

          <ul className="text-muted-foreground space-y-1.5 text-sm">
            {[
              "Obligations cite an exact, machine-verified quote",
              "Draft rules are backtested before anyone sees them",
              "An independent challenger agent reviews every draft",
              "Append-only audit trail from circular to approval",
            ].map((line) => (
              <li key={line} className="flex gap-2">
                <span className="text-primary mt-[7px] size-1 shrink-0 rounded-full bg-current" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="w-full max-w-sm self-center">
          <LoginForm next={next} demoUsers={demoUsers} />
        </div>
      </div>
    </div>
  );
}
