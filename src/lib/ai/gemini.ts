import { GoogleGenAI } from "@google/genai";

import { env } from "@/lib/env";

/** Shared Gemini client (Google AI Studio / Gemini Developer API). */
export const genai = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });

/** Default model for agent reasoning and structured extraction. */
export const GEMINI_MODEL = env.GEMINI_MODEL;

/** Cheaper, faster model for high-volume calls (chunk triage, labelling). */
export const GEMINI_MODEL_LITE = env.GEMINI_MODEL_LITE;

/**
 * Used in place of {@link GEMINI_MODEL} when its quota is exhausted, if set.
 * Which model actually answered is recorded on every `agent_runs` row.
 */
export const GEMINI_MODEL_FALLBACK = env.GEMINI_MODEL_FALLBACK ?? null;

/** Model used for pgvector embeddings of circular chunks. */
export const EMBEDDING_MODEL = "gemini-embedding-001";

/**
 * Output dimensionality requested from {@link EMBEDDING_MODEL}. Must stay in
 * step with the `vector(768)` column on `circular_chunks.embedding`.
 */
export const EMBEDDING_DIMENSIONS = 768;
