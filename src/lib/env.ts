import { z } from "zod";

/**
 * Validated environment variables. Importing this module throws early (at
 * startup) with a readable message instead of failing deep inside a request.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_URL_UNPOOLED: z.string().url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  GOOGLE_API_KEY: z.string().min(1),
  /** Main reasoning model: obligation extraction, rule drafting, review. */
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  /** Cheap model for high-volume, low-stakes calls: chunk triage, labelling. */
  GEMINI_MODEL_LITE: z.string().default("gemini-3.5-flash-lite"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env = parsed.data;
