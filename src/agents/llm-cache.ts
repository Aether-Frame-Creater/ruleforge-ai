/**
 * Response cache for model calls, so development does not burn a daily quota.
 *
 * `LLM_MODE` picks the behaviour:
 * - `cache`  — read-through: a saved response is used when one exists, otherwise
 *              the API is called and the result saved (the default);
 * - `record` — always calls the API and saves the response;
 * - `live`   — always calls the API and saves, ignoring what is already cached;
 * - `replay` — serves saved responses only, and never calls the API at all.
 *
 * The cache key covers everything that could change an answer: the model asked
 * for, the full system instruction, and every part of the prompt including the
 * bytes of an attached PDF. Change a prompt and the old entry is simply never
 * looked up again, so a stale response cannot silently stand in for a new one.
 *
 * The entry records which model actually answered, which can differ from the
 * model in the key when the quota fallback took over.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { env } from "@/lib/env";

export type LlmMode = "cache" | "live" | "record" | "replay";

export const CACHE_DIR = "storage/llm-cache";

/** The mode for this process. */
export function llmMode(): LlmMode {
  return env.LLM_MODE;
}

/** Raised in replay mode when nothing has been recorded for a call. */
export class ReplayMissError extends Error {
  constructor(agent: string, key: string) {
    super(
      `${agent}: no recorded response for this call (cache key ${key.slice(0, 12)}…). ` +
        `LLM_MODE=replay never calls the API. Run once with LLM_MODE=record ` +
        `(or live) to populate ${CACHE_DIR}, then replay.`,
    );
    this.name = "ReplayMissError";
  }
}

/** What a cached generate call stores. */
export interface CachedGeneration {
  kind: "generate";
  /** The model requested; part of the key. */
  model: string;
  /** The model that actually answered — the fallback, if one was used. */
  modelUsed: string;
  agent: string;
  text: string;
  usage: {
    prompt: number;
    candidates: number;
    thoughts: number;
    total: number;
  };
  recordedAt: string;
}

/** What a cached embedding batch stores. */
export interface CachedEmbeddings {
  kind: "embed";
  model: string;
  dimensions: number;
  /** One vector per input text; null where the API returned nothing usable. */
  embeddings: Array<number[] | null>;
  recordedAt: string;
}

/** A prompt part reduced to something stable and hashable. */
export type HashablePart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/**
 * Builds the cache key.
 *
 * Hashed incrementally so a large inline PDF never has to be concatenated into
 * one string, and length-prefixed so two different field splits cannot collide.
 */
export function cacheKey(input: {
  kind: "generate" | "embed";
  model: string;
  /** The full system instruction, preamble included. */
  instruction: string;
  parts: HashablePart[];
}): string {
  const hash = createHash("sha256");
  const feed = (label: string, value: string) => {
    hash.update(`${label}:${value.length}:`);
    hash.update(value);
  };

  feed("kind", input.kind);
  feed("model", input.model);
  feed("instruction", input.instruction);
  hash.update(`parts:${input.parts.length}:`);
  for (const part of input.parts) {
    if ("text" in part) {
      feed("text", part.text);
    } else {
      feed("mime", part.inlineData.mimeType);
      feed("data", part.inlineData.data);
    }
  }

  return hash.digest("hex");
}

function entryPath(key: string): string {
  return join(CACHE_DIR, `${key}.json`);
}

/** Reads a cached entry, or null if nothing was recorded for this key. */
export async function readCached<T>(key: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(entryPath(key), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Saves an entry. Writing the cache must never fail a run. */
export async function writeCached(key: string, value: unknown): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(entryPath(key), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn(
      `  ! could not write the response cache: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
