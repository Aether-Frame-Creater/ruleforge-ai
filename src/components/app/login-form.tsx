"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { demoSignInAction, signInAction } from "@/lib/actions/auth-actions";

interface DemoUser {
  role: string;
  label: string;
  description: string;
  email: string;
}

export function LoginForm({
  next,
  demoUsers,
}: {
  next: string;
  demoUsers: DemoUser[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  /**
   * Navigates after a successful sign-in.
   *
   * Called from a plain async handler, never from inside `startTransition`:
   * a `router.push` issued after an `await` within a transition is dropped,
   * which left the browser sitting on the login page with a valid session.
   */
  function goTo(destination: string) {
    router.push(destination);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setError(null);
    setFieldErrors({});
    setPending(true);

    const result = await signInAction({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      next,
    });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }
    goTo(result.data.next);
  }

  async function onDemo(demo: DemoUser) {
    setError(null);
    setBusyEmail(demo.email);
    setPending(true);

    const result = await demoSignInAction({ email: demo.email, next });
    setPending(false);
    setBusyEmail(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`Signed in as ${demo.label}`);
    goTo(result.data.next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Use your work email address and password.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@bank.example"
              required
              aria-invalid={Boolean(fieldErrors.email)}
            />
            {fieldErrors.email?.map((message) => (
              <p key={message} className="text-destructive text-xs">
                {message}
              </p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={Boolean(fieldErrors.password)}
            />
            {fieldErrors.password?.map((message) => (
              <p key={message} className="text-destructive text-xs">
                {message}
              </p>
            ))}
          </div>

          <Button type="submit" className="w-full" disabled={pending}>
            {pending && !busyEmail && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Sign in
          </Button>
        </form>

        {demoUsers.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                demo mode — sign in as
              </span>
              <Separator className="flex-1" />
            </div>

            <div className="grid gap-2">
              {demoUsers.map((demo) => (
                <Button
                  key={demo.email}
                  type="button"
                  variant="outline"
                  className="h-auto justify-start py-2.5 text-left"
                  disabled={pending}
                  onClick={() => onDemo(demo)}
                >
                  {busyEmail === demo.email ? (
                    <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <span className="bg-muted text-muted-foreground mr-2 grid size-6 shrink-0 place-items-center rounded text-[11px] font-medium uppercase">
                      {demo.role.slice(0, 2)}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {demo.label}
                    </span>
                    <span className="text-muted-foreground block text-xs font-normal">
                      {demo.description}
                    </span>
                  </span>
                </Button>
              ))}
            </div>

            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Demo sign-in is enabled by DEMO_MODE and works only for
              @ruleforge.demo accounts. The password stays on the server.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
