import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 py-16 text-center">
      <p className="font-heading text-2xl font-semibold">Not found</p>
      <p className="text-muted-foreground max-w-md text-sm">
        That record does not exist, or it was removed by a demo reset.
      </p>
      <Button asChild variant="outline">
        <Link href="/dashboard">Back to the dashboard</Link>
      </Button>
    </div>
  );
}
