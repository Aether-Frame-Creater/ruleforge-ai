"use client";

import { AlertCircle } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 py-16 text-center">
      <AlertCircle className="text-destructive size-8" />
      <div>
        <p className="font-medium">Something went wrong on this page</p>
        <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
          {error.message ||
            "The page could not be loaded. The details are in the server log."}
        </p>
        {error.digest && (
          <p className="text-muted-foreground mt-2 font-mono text-xs">
            reference: {error.digest}
          </p>
        )}
      </div>
      <Button onClick={reset} variant="outline">
        Try again
      </Button>
    </div>
  );
}
