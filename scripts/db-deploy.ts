/**
 * Applies the schema and the database guards to a target database.
 *
 *   npm run db:deploy                      # uses .env.local
 *   DATABASE_URL_UNPOOLED=... npm run db:deploy
 *
 * `drizzle-kit migrate` rather than `push`: a deployment applies the migration
 * files that were reviewed, not whatever the local schema happens to say. The
 * guards run afterwards because `migrate` does not know about the append-only
 * trigger or the role CHECK, and would otherwise leave them uninstalled.
 */
import { execFileSync } from "node:child_process";

function run(command: string, args: string[]) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

function main() {
  const target = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!target) {
    console.error(
      "DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set to the target database.",
    );
    process.exit(1);
  }

  // Never print the password.
  const redacted = target.replace(/:\/\/[^@]+@/, "://***@");
  console.log(`Deploying schema to ${redacted}`);

  run("npx", ["drizzle-kit", "migrate"]);
  run("node", ["scripts/run-sql.mjs", "src/db/sql/guards.sql"]);

  console.log("\nSchema and guards applied.");
  console.log(
    "If this is a new database, also run: node scripts/run-sql.mjs src/db/extensions.sql",
  );
}

main();
