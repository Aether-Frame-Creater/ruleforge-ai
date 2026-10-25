import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

import { env } from "@/lib/env";
import * as schema from "@/db/schema";

const sql = neon(env.DATABASE_URL);

/** Drizzle client bound to Neon over HTTP — safe in serverless/edge runtimes. */
export const db = drizzle(sql, { schema });

export { schema };
