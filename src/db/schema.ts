/**
 * Drizzle schema for RuleForge AI.
 *
 * Conventions:
 * - App tables use `uuid` primary keys with `defaultRandom()`.
 * - Foreign keys to Better Auth's `user` table use its `text` id type.
 * - Every status/type column is a `pgEnum`, so the database rejects values the
 *   application does not know about.
 * - `created_at` is `timestamp with time zone` defaulting to `now()`.
 *
 * Referential actions are chosen for an audit trail: evidence rows
 * (`circular_chunks`, `agent_runs`) cascade with their parent, attribution
 * columns (`uploaded_by`, `reviewed_by`) fall back to NULL so the record
 * survives a user being removed, and a user who signed an approval cannot be
 * deleted at all (`restrict`).
 */
import { relations, sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { RulesLogic } from "json-logic-js";

import { user } from "./auth-schema";

export * from "./auth-schema";

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const regulatorEnum = pgEnum("regulator", [
  "rbi",
  "sebi",
  "irdai",
  "fiu_ind",
  "other",
]);

export const circularStatusEnum = pgEnum("circular_status", [
  "uploaded",
  "analysing",
  "not_applicable",
  "review",
  "approved",
  "rejected",
  "deployed",
]);

export const obligationTypeEnum = pgEnum("obligation_type", [
  "reporting",
  "threshold",
  "kyc",
  "limit",
  "timeline",
  "other",
]);

export const obligationStatusEnum = pgEnum("obligation_status", [
  "extracted",
  "confirmed",
  "edited",
  "rejected",
]);

export const ruleCategoryEnum = pgEnum("rule_category", [
  "aml",
  "kyc",
  "lending",
  "fraud",
]);

export const ruleVersionStatusEnum = pgEnum("rule_version_status", [
  "draft",
  // An officer has put the draft forward; it is now awaiting a head's decision.
  "submitted",
  "approved",
  "shadow",
  "live",
  // A live version that a newer one replaced. Rollback restores the latest one.
  "retired",
  "rolled_back",
  "rejected",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "cash_deposit",
  "cash_withdrawal",
  "transfer",
  "upi",
  "card",
  "loan_disbursal",
]);

export const transactionChannelEnum = pgEnum("transaction_channel", [
  "branch",
  "atm",
  "mobile",
  "internet",
]);

export const approvalDecisionEnum = pgEnum("approval_decision", [
  "approved",
  "rejected",
]);

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

/* -------------------------------------------------------------------------- */
/* Circulars                                                                  */
/* -------------------------------------------------------------------------- */

/** A regulatory circular as uploaded, plus the verdict on whether it applies. */
export const circulars = pgTable("circulars", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  regulator: regulatorEnum("regulator").notNull(),
  /** The regulator's own reference, e.g. "RBI/2025-26/42". */
  circularNumber: text("circular_number"),
  issuedDate: date("issued_date"),
  pdfUrl: text("pdf_url").notNull(),
  status: circularStatusEnum("status").notNull().default("uploaded"),
  /** Why the applicability agent decided this does or does not bind us. */
  applicabilityReason: text("applicability_reason"),
  uploadedBy: text("uploaded_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** A paragraph of a circular, embedded for retrieval. */
export const circularChunks = pgTable(
  "circular_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circularId: uuid("circular_id")
      .notNull()
      .references(() => circulars.id, { onDelete: "cascade" }),
    /** Human-citable location in the source document, e.g. "Para 4.2". */
    paragraphRef: text("paragraph_ref"),
    text: text("text").notNull(),
    // Literal, not the `EMBEDDING_DIMENSIONS` constant: drizzle-kit loads this
    // file outside the Next.js module graph. Keep the two in step.
    embedding: vector("embedding", { dimensions: 768 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("circular_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Obligations                                                                */
/* -------------------------------------------------------------------------- */

/** One discrete requirement lifted out of a circular, traceable to a paragraph. */
export const obligations = pgTable("obligations", {
  id: uuid("id").primaryKey().defaultRandom(),
  circularId: uuid("circular_id")
    .notNull()
    .references(() => circulars.id),
  /** Source paragraph. Nulled rather than deleted if the circular is removed. */
  chunkId: uuid("chunk_id").references(() => circularChunks.id, {
    onDelete: "set null",
  }),
  summary: text("summary").notNull(),
  obligationType: obligationTypeEnum("obligation_type").notNull(),
  deadline: date("deadline"),
  status: obligationStatusEnum("status").notNull().default("extracted"),
  reviewedBy: text("reviewed_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Rules                                                                      */
/* -------------------------------------------------------------------------- */

/** A compliance rule, identified by a stable code like "R-112". */
export const rules = pgTable("rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: ruleCategoryEnum("category").notNull(),
  /**
   * The version currently in force. Deliberately not a foreign key: `rules`
   * and `rule_versions` would otherwise reference each other and neither row
   * could be inserted first.
   */
  currentVersionId: uuid("current_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** An immutable revision of a rule's json-logic, with its lifecycle status. */
export const ruleVersions = pgTable(
  "rule_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => rules.id),
    version: integer("version").notNull(),
    jsonLogic: jsonb("json_logic").$type<RulesLogic>().notNull(),
    /** The obligation this revision was drafted to satisfy, if any. */
    obligationId: uuid("obligation_id").references(() => obligations.id, {
      onDelete: "set null",
    }),
    status: ruleVersionStatusEnum("status").notNull().default("draft"),
    /** Who put this version forward for approval, and when. */
    submittedBy: text("submitted_by").references(() => user.id, {
      onDelete: "set null",
    }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /**
     * Share of customers on this version while it is in shadow, in stages
     * (10, 50, then 100 at which point it goes live). Zero means no customer
     * is on it yet.
     */
    rolloutPercent: integer("rollout_percent").notNull().default(0),
    shadowStartedAt: timestamp("shadow_started_at", { withTimezone: true }),
    liveAt: timestamp("live_at", { withTimezone: true }),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    rollbackReason: text("rollback_reason"),
    changeSummary: text("change_summary"),
    /** Which agent drafted it, e.g. "rule_drafter". */
    createdByAgent: text("created_by_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // A unique *index*, not a unique constraint: drizzle-kit 0.31 re-diffs
  // composite unique constraints on every push. Same guarantee either way.
  (table) => [
    uniqueIndex("rule_versions_rule_id_version_idx").on(
      table.ruleId,
      table.version,
    ),
    check(
      "rule_versions_rollout_percent_range",
      sql`${table.rolloutPercent} BETWEEN 0 AND 100`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Backtesting                                                                */
/* -------------------------------------------------------------------------- */

/** Synthetic transactions the backtester replays candidate rules against. */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: text("customer_id").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("INR"),
    type: transactionTypeEnum("type").notNull(),
    channel: transactionChannelEnum("channel").notNull(),
    branch: text("branch"),
    country: text("country").notNull().default("IN"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("transactions_timestamp_idx").on(table.timestamp),
    index("transactions_customer_id_idx").on(table.customerId),
  ],
);

/** The measured effect of a candidate rule version against a baseline. */
export const backtestRuns = pgTable("backtest_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleVersionId: uuid("rule_version_id")
    .notNull()
    .references(() => ruleVersions.id),
  /** The version compared against. Null means "no rule in force before". */
  baselineVersionId: uuid("baseline_version_id").references(
    () => ruleVersions.id,
  ),
  totalTxns: integer("total_txns").notNull().default(0),
  oldAlerts: integer("old_alerts").notNull().default(0),
  newAlerts: integer("new_alerts").notNull().default(0),
  customersAffected: integer("customers_affected").notNull().default(0),
  /** Full result payload: per-transaction diffs, histograms, samples. */
  resultJson: jsonb("result_json"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A side-by-side comparison of the live rule and a shadow rule.
 *
 * The shadow rule is only ever *evaluated* here; it raises no alert for any
 * customer. These rows are the evidence an operator reads before widening a
 * rollout.
 */
export const shadowRuns = pgTable("shadow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleVersionId: uuid("rule_version_id")
    .notNull()
    .references(() => ruleVersions.id),
  /** The live version compared against. Null if no rule was live. */
  baselineVersionId: uuid("baseline_version_id").references(
    () => ruleVersions.id,
  ),
  txnsEvaluated: integer("txns_evaluated").notNull().default(0),
  liveAlerts: integer("live_alerts").notNull().default(0),
  shadowAlerts: integer("shadow_alerts").notNull().default(0),
  alertsOnlyLive: integer("alerts_only_live").notNull().default(0),
  alertsOnlyShadow: integer("alerts_only_shadow").notNull().default(0),
  /** Null when the live rule raised nothing, so a percentage is undefined. */
  alertRateChangePct: numeric("alert_rate_change_pct", {
    precision: 10,
    scale: 2,
  }),
  resultJson: jsonb("result_json"),
  createdBy: text("created_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Approvals and audit                                                        */
/* -------------------------------------------------------------------------- */

/** A maker-checker decision on a rule version. */
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleVersionId: uuid("rule_version_id")
      .notNull()
      .references(() => ruleVersions.id),
    makerId: text("maker_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    checkerId: text("checker_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    decision: approvalDecisionEnum("decision").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "approvals_maker_is_not_checker",
      sql`${table.checkerId} <> ${table.makerId}`,
    ),
  ],
);

/** One execution of one agent, for observability and replay. */
export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  circularId: uuid("circular_id")
    .notNull()
    .references(() => circulars.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  status: agentRunStatusEnum("status").notNull().default("queued"),
  input: jsonb("input"),
  output: jsonb("output"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/**
 * Append-only audit trail. `actor` is a user id or an agent name, so it is not
 * a foreign key. INSERT-only is enforced by a trigger in `src/db/sql/guards.sql`.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    /** Text, not uuid: entities include `user` rows, which have text ids. */
    entityId: text("entity_id").notNull(),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * App-side relations on Better Auth's `user`. Drizzle merges these with the
 * `userRelations` export in `auth-schema.ts`, which covers sessions/accounts.
 */
export const userAppRelations = relations(user, ({ many }) => ({
  uploadedCirculars: many(circulars),
  reviewedObligations: many(obligations),
  submittedRuleVersions: many(ruleVersions, {
    relationName: "ruleVersionSubmitter",
  }),
  approvalsAsMaker: many(approvals, { relationName: "approvalMaker" }),
  approvalsAsChecker: many(approvals, { relationName: "approvalChecker" }),
}));

export const circularsRelations = relations(circulars, ({ one, many }) => ({
  uploadedByUser: one(user, {
    fields: [circulars.uploadedBy],
    references: [user.id],
  }),
  chunks: many(circularChunks),
  obligations: many(obligations),
  agentRuns: many(agentRuns),
}));

export const circularChunksRelations = relations(
  circularChunks,
  ({ one, many }) => ({
    circular: one(circulars, {
      fields: [circularChunks.circularId],
      references: [circulars.id],
    }),
    obligations: many(obligations),
  }),
);

export const obligationsRelations = relations(obligations, ({ one, many }) => ({
  circular: one(circulars, {
    fields: [obligations.circularId],
    references: [circulars.id],
  }),
  chunk: one(circularChunks, {
    fields: [obligations.chunkId],
    references: [circularChunks.id],
  }),
  reviewedByUser: one(user, {
    fields: [obligations.reviewedBy],
    references: [user.id],
  }),
  ruleVersions: many(ruleVersions),
}));

export const rulesRelations = relations(rules, ({ one, many }) => ({
  versions: many(ruleVersions, { relationName: "ruleVersionsOfRule" }),
  currentVersion: one(ruleVersions, {
    fields: [rules.currentVersionId],
    references: [ruleVersions.id],
    relationName: "ruleCurrentVersion",
  }),
}));

export const ruleVersionsRelations = relations(
  ruleVersions,
  ({ one, many }) => ({
    rule: one(rules, {
      fields: [ruleVersions.ruleId],
      references: [rules.id],
      relationName: "ruleVersionsOfRule",
    }),
    obligation: one(obligations, {
      fields: [ruleVersions.obligationId],
      references: [obligations.id],
    }),
    submitter: one(user, {
      fields: [ruleVersions.submittedBy],
      references: [user.id],
      relationName: "ruleVersionSubmitter",
    }),
    backtestRuns: many(backtestRuns, { relationName: "backtestCandidate" }),
    baselineForBacktestRuns: many(backtestRuns, {
      relationName: "backtestBaseline",
    }),
    approvals: many(approvals),
    shadowRuns: many(shadowRuns, { relationName: "shadowCandidate" }),
  }),
);

export const shadowRunsRelations = relations(shadowRuns, ({ one }) => ({
  ruleVersion: one(ruleVersions, {
    fields: [shadowRuns.ruleVersionId],
    references: [ruleVersions.id],
    relationName: "shadowCandidate",
  }),
  baselineVersion: one(ruleVersions, {
    fields: [shadowRuns.baselineVersionId],
    references: [ruleVersions.id],
    relationName: "shadowBaseline",
  }),
  creator: one(user, {
    fields: [shadowRuns.createdBy],
    references: [user.id],
  }),
}));

export const backtestRunsRelations = relations(backtestRuns, ({ one }) => ({
  ruleVersion: one(ruleVersions, {
    fields: [backtestRuns.ruleVersionId],
    references: [ruleVersions.id],
    relationName: "backtestCandidate",
  }),
  baselineVersion: one(ruleVersions, {
    fields: [backtestRuns.baselineVersionId],
    references: [ruleVersions.id],
    relationName: "backtestBaseline",
  }),
}));

export const approvalsRelations = relations(approvals, ({ one }) => ({
  ruleVersion: one(ruleVersions, {
    fields: [approvals.ruleVersionId],
    references: [ruleVersions.id],
  }),
  maker: one(user, {
    fields: [approvals.makerId],
    references: [user.id],
    relationName: "approvalMaker",
  }),
  checker: one(user, {
    fields: [approvals.checkerId],
    references: [user.id],
    relationName: "approvalChecker",
  }),
}));

export const agentRunsRelations = relations(agentRuns, ({ one }) => ({
  circular: one(circulars, {
    fields: [agentRuns.circularId],
    references: [circulars.id],
  }),
}));

/* -------------------------------------------------------------------------- */
/* Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type Circular = typeof circulars.$inferSelect;
export type NewCircular = typeof circulars.$inferInsert;

export type CircularChunk = typeof circularChunks.$inferSelect;
export type NewCircularChunk = typeof circularChunks.$inferInsert;

export type Obligation = typeof obligations.$inferSelect;
export type NewObligation = typeof obligations.$inferInsert;

export type Rule = typeof rules.$inferSelect;
export type NewRule = typeof rules.$inferInsert;

export type RuleVersion = typeof ruleVersions.$inferSelect;
export type NewRuleVersion = typeof ruleVersions.$inferInsert;

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

export type BacktestRun = typeof backtestRuns.$inferSelect;
export type NewBacktestRun = typeof backtestRuns.$inferInsert;

export type ShadowRun = typeof shadowRuns.$inferSelect;
export type NewShadowRun = typeof shadowRuns.$inferInsert;

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
