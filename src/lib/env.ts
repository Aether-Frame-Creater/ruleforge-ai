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
  GEMINI_MODEL: z.string().default("gemini-2.5-pro"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env = parsed.data;
