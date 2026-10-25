/**
 * Runs a .sql file against DATABASE_URL_UNPOOLED (falling back to DATABASE_URL).
 *
 *   node scripts/run-sql.mjs src/db/sql/guards.sql
 *
 * drizzle-kit only applies schema it can diff; triggers and functions are
 * applied with this instead. The whole file runs in one transaction, so a
 * failure part-way leaves nothing behind.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import { config } from "dotenv";
import { Client } from "@neondatabase/serverless";

config({ path: ".env.local" });

const file = argv[2];
if (!file) {
  console.error("usage: node scripts/run-sql.mjs <file.sql>");
  exit(1);
}

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is missing in .env.local");
  exit(1);
}

const sql = await readFile(file, "utf8");
const client = new Client(url);

await client.connect();
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log(`applied ${file}`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`failed to apply ${file}`);
  console.error(error instanceof Error ? error.message : error);
  exit(1);
} finally {
  await client.end();
}
