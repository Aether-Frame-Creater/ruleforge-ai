/**
 * Drizzle schema for RuleForge AI.
 *
 * Intentionally empty for now. Tables land here as the domain is built out:
 * Better Auth tables (user/session/account/verification), circulars,
 * obligations, rule versions, backtest runs and approvals. The
 * `vector` column type from `drizzle-orm/pg-core` is used for pgvector
 * embeddings of circular chunks.
 */
export {};
