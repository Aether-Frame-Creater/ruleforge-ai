import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";

import * as schema from "@/db/schema";
import { env } from "@/lib/env";

/**
 * A pooled client that supports real transactions.
 *
 * The HTTP driver in `./index.ts` is one request per statement and refuses
 * `transaction()` outright ("No transactions support in neon-http driver"), so
 * anything that must be all-or-nothing — the deployment steps, which change
 * which rule is in force and must never leave a rule with no version live —
 * goes over a WebSocket connection instead.
 *
 * Read paths stay on the HTTP client: it is cheaper and needs no connection.
 */
const pool = new Pool({ connectionString: env.DATABASE_URL });

export const txDb = drizzle(pool, { schema });

/** Closes the pool. Scripts call this; the server keeps it open. */
export async function closeTxPool(): Promise<void> {
  await pool.end();
}
