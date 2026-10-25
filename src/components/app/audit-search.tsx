"use client";

import { Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AuditSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const [pending, startTransition] = useTransition();

  function run(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim()) params.set("q", next.trim());
    else params.delete("q");
    startTransition(() => {
      router.push(`/audit${params.toString() ? `?${params}` : ""}`);
    });
  }

  return (
    <form
      className="mb-4 flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        run(value);
      }}
    >
      <div className="relative flex-1">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Search by actor, action, entity type or id…"
          className="pl-9"
          aria-label="Search the audit trail"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              run("");
            }}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Searching…" : "Search"}
      </Button>
    </form>
  );
}
