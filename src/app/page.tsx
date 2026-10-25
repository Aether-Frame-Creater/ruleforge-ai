import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth/guards";

/**
 * Per-user and always current: this route reads the session and live database
 * state, so it is never prerendered.
 */
export const instant = false;

export default async function RootPage() {
  const user = await currentUser();
  redirect(user ? "/dashboard" : "/login");
}
