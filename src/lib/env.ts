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
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),
  /** Cheap model for high-volume, low-stakes calls: chunk triage, labelling. */
  GEMINI_MODEL_LITE: z.string().default("gemini-3.5-flash-lite"),
  /**
   * Stand-in for the main model when its request quota is exhausted. Optional:
   * without it, a quota failure stops the run rather than silently degrading
   * the model that writes and reviews rules.
   */
  GEMINI_MODEL_FALLBACK: z.string().optional(),
  /**
   * How agent calls reach Gemini:
   * - `cache`  read-through: serves a saved response when one exists, otherwise
   *            calls the API and saves the result (the default);
   * - `record` always calls the API and saves each response;
   * - `live`   always calls the API and saves, ignoring what is already cached;
   * - `replay` serves saved responses only and never calls the API.
   */
  LLM_MODE: z.enum(["cache", "live", "record", "replay"]).default("cache"),
  /**
   * Shows one-click sign-in buttons for the seeded demo users on the login
   * page. Never enable this anywhere real: it hands out sessions.
   */
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /**
   * Password for the demo users created by `npm run db:seed`. Optional so the
   * app still boots without it; the seed script fails loudly if it is missing.
   * Better Auth requires at least 8 characters.
   */
  DEMO_PASSWORD: z.string().min(8).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env = parsed.data;
