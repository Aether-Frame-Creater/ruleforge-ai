import { GoogleGenAI } from "@google/genai";

import { env } from "@/lib/env";

/** Shared Gemini client (Google AI Studio / Gemini Developer API). */
export const genai = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });

/** Default model for agent reasoning and structured extraction. */
export const GEMINI_MODEL = env.GEMINI_MODEL;

/** Model used for pgvector embeddings of circular chunks. */
export const EMBEDDING_MODEL = "gemini-embedding-001";
