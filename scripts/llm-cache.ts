/**
 * Moves the recorded model responses between environments.
 *
 *   npm run cache:export -- cache.json          # table  -> JSON file
 *   npm run cache:import -- cache.json          # JSON   -> table
 *   npm run cache:import -- storage/llm-cache   # a legacy on-disk cache
 *
 * A warm cache is what makes `LLM_MODE=replay` work, so a demo environment can
 * be seeded with one instead of spending a day's API quota rebuilding it.
 * Importing never overwrites an existing key: the first recording of a prompt
 * is the one that matches what was reviewed.
 */
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { llmCache } from "@/db/schema";
import { db } from "@/lib/db";

interface ExportedEntry {
  cache_key: string;
  model: string;
  response: unknown;
  created_at: string;
}

async function exportCache(target: string) {
  const rows = await db
    .select({
      cacheKey: llmCache.cacheKey,
      model: llmCache.model,
      response: llmCache.response,
      createdAt: llmCache.createdAt,
    })
    .from(llmCache);

  const entries: ExportedEntry[] = rows.map((row) => ({
    cache_key: row.cacheKey,
    model: row.model,
    response: row.response,
    created_at: row.createdAt.toISOString(),
  }));

  await writeFile(target, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  console.log(`exported ${entries.length} cache entries to ${target}`);
}

/** Reads either an exported JSON file or a legacy `storage/llm-cache` folder. */
async function readEntries(source: string): Promise<ExportedEntry[]> {
  const info = await stat(source);

  if (info.isDirectory()) {
    const files = (await readdir(source)).filter((f) => f.endsWith(".json"));
    const entries: ExportedEntry[] = [];
    for (const file of files) {
      const response = JSON.parse(await readFile(join(source, file), "utf8"));
      entries.push({
        cache_key: file.replace(/\.json$/, ""),
        model: typeof response?.model === "string" ? response.model : "unknown",
        response,
        created_at: new Date().toISOString(),
      });
    }
    return entries;
  }

  const parsed = JSON.parse(await readFile(source, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`${source} is not an array of cache entries.`);
  }
  return parsed as ExportedEntry[];
}

async function importCache(source: string) {
  const entries = await readEntries(source);
  let inserted = 0;

  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100);
    const result = await db
      .insert(llmCache)
      .values(
        batch.map((entry) => ({
          cacheKey: entry.cache_key,
          model: entry.model ?? "unknown",
          response: entry.response as never,
        })),
      )
      .onConflictDoNothing({ target: llmCache.cacheKey })
      .returning({ key: llmCache.cacheKey });
    inserted += result.length;
  }

  console.log(
    `imported ${inserted} new entries from ${source} ` +
      `(${entries.length - inserted} already present)`,
  );
}

async function main() {
  const [mode, target] = process.argv.slice(2);

  if (mode !== "export" && mode !== "import") {
    console.error("usage: tsx scripts/llm-cache.ts <export|import> <path>");
    process.exit(2);
  }
  if (!target) {
    console.error(`A path is required for ${mode}.`);
    process.exit(2);
  }

  if (mode === "export") await exportCache(target);
  else await importCache(target);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nllm-cache failed:");
    console.error(error);
    process.exit(1);
  });
