/**
 * Agent-run polling endpoint for the circular page.
 *
 * A route rather than a server action because the timeline polls while the
 * pipeline runs, and a GET that returns JSON is the honest shape for that.
 * It is read-only and behind a session; it exposes nothing a signed-in user
 * cannot already see on the page.
 */
import { NextResponse } from "next/server";

import { optionalUser } from "@/lib/auth/guards";
import { getAgentRuns, getCircular } from "@/lib/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await optionalUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const circular = await getCircular(id);
  if (!circular) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const runs = await getAgentRuns(id);

  return NextResponse.json(
    {
      status: circular.status,
      runs,
      // The client stops polling on this rather than guessing from statuses.
      settled:
        circular.status !== "uploaded" &&
        circular.status !== "analysing" &&
        !runs.some((run) => run.status === "running" || run.status === "queued"),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
