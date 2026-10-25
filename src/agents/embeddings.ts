/**
 * Paragraph storage and embeddings.
 *
 * Each paragraph of a circular is written to `circular_chunks` with a 768-
 * dimension embedding, so obligations can point at the exact chunk they came
 * from and so future circulars can be compared against what we already hold.
 *
 * Embedding failures do not fail the pipeline: the paragraph is still stored,
 * with a null embedding, because the citation trail matters more than the
 * vector. The caller is told which chunks ended up without one.
 */
import { GoogleGenAI } from "@google/genai";

import { circularChunks } from "@/db/schema";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  genai as sharedGenai,
} from "@/lib/ai/gemini";
import { db } from "@/lib/db";

import {
  cacheKey,
  llmMode,
  readCached,
  ReplayMissError,
  writeCached,
  type CachedEmbeddings,
} from "./llm-cache";
import { isRetryable } from "./runtime";
import type { IntakeParagraph } from "./intake-agent";
import type { StoredChunk } from "./types";

/** Paragraphs per embedding request. */
const EMBED_BATCH_SIZE = 20;
const MAX_EMBED_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Embeds a batch of texts, retrying transient failures.
 *
 * `outputDimensionality` is pinned to the column width: gemini-embedding-001
 * returns 3072 dimensions by default, which would not fit `vector(768)`.
 */
async function embedBatch(
  client: GoogleGenAI,
  texts: string[],
): Promise<Array<number[] | null>> {
  // Embeddings are API calls too, so they obey LLM_MODE as well: a replay run
  // that still reached out to the embedding endpoint would not be a replay.
  const mode = llmMode();
  const key = cacheKey({
    kind: "embed",
    model: EMBEDDING_MODEL,
    instruction: `dimensions=${EMBEDDING_DIMENSIONS}`,
    parts: texts.map((text) => ({ text })),
  });

  if (mode === "replay" || mode === "cache") {
    const cached = await readCached<CachedEmbeddings>(key);
    if (cached) return cached.embeddings;
    if (mode === "replay") throw new ReplayMissError("embeddings", key);
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_EMBED_ATTEMPTS; attempt += 1) {
    try {
      const response = await client.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: texts,
        config: {
          outputDimensionality: EMBEDDING_DIMENSIONS,
          taskType: "RETRIEVAL_DOCUMENT",
        },
      });

      const embeddings = texts.map((_, index) => {
        const values = response.embeddings?.[index]?.values;
        return values && values.length === EMBEDDING_DIMENSIONS ? values : null;
      });

      // Every mode that reaches the API saves the result; `replay` returned above.
      {
        const entry: CachedEmbeddings = {
          kind: "embed",
          model: EMBEDDING_MODEL,
          dimensions: EMBEDDING_DIMENSIONS,
          embeddings,
          recordedAt: new Date().toISOString(),
        };
        await writeCached(key, entry);
      }

      return embeddings;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_EMBED_ATTEMPTS) break;
      await sleep(Math.min(1_000 * 2 ** (attempt - 1), 8_000));
    }
  }

  console.warn(
    `  ! embedding batch failed, storing paragraphs without vectors: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
  return texts.map(() => null);
}

/**
 * Stores every paragraph as a chunk and returns them with their ids.
 *
 * Rows are inserted first and embeddings applied in the same insert, so a
 * paragraph is never visible without its text.
 */
export async function storeCircularChunks(params: {
  circularId: string;
  paragraphs: IntakeParagraph[];
  client?: GoogleGenAI;
}): Promise<{ chunks: StoredChunk[]; embedded: number; failed: number }> {
  if (params.paragraphs.length === 0) {
    return { chunks: [], embedded: 0, failed: 0 };
  }

  const client = params.client ?? sharedGenai;
  const embeddings: Array<number[] | null> = [];

  for (let i = 0; i < params.paragraphs.length; i += EMBED_BATCH_SIZE) {
    const batch = params.paragraphs.slice(i, i + EMBED_BATCH_SIZE);
    embeddings.push(...(await embedBatch(client, batch.map((p) => p.text))));
  }

  const rows = await db
    .insert(circularChunks)
    .values(
      params.paragraphs.map((paragraph, index) => ({
        circularId: params.circularId,
        paragraphRef: paragraph.paragraphRef,
        text: paragraph.text,
        embedding: embeddings[index],
      })),
    )
    .returning({
      id: circularChunks.id,
      paragraphRef: circularChunks.paragraphRef,
      text: circularChunks.text,
    });

  const chunks: StoredChunk[] = rows.map((row, index) => ({
    chunkId: row.id,
    paragraphRef: row.paragraphRef ?? params.paragraphs[index].paragraphRef,
    text: row.text,
    embedded: embeddings[index] !== null,
  }));

  return {
    chunks,
    embedded: embeddings.filter((e) => e !== null).length,
    failed: embeddings.filter((e) => e === null).length,
  };
}
