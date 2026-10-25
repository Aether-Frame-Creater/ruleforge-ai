/**
 * Seeds the demo dataset: four users (one per role), five live rules, and
 * 50,000 synthetic transactions.
 *
 * Run with `npm run db:seed`. Safe to run twice:
 * - users are created only if the email is not already present;
 * - rules and rule versions use ON CONFLICT DO NOTHING on their natural keys;
 * - transaction ids are generated from a fixed faker seed, so the same 50,000
 *   rows are produced every time and re-inserting them is a no-op.
 *
 * Determinism comes from {@link SEED} plus {@link REFERENCE_DATE}. The date has
 * to be a constant, not `Date.now()`: faker's relative date helpers would
 * otherwise produce different data on every run. The practical consequence is
 * that the 90-day window is fixed in place rather than rolling forward.
 */
import { faker } from "@faker-js/faker";
import { eq, inArray, sql } from "drizzle-orm";
import type { RulesLogic } from "json-logic-js";

import { auth, USER_ROLES, type UserRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { assertRule, type RuleLogic } from "@/rules/schema";

import {
  rules,
  ruleVersions,
  transactions,
  user,
  type NewTransaction,
} from "./schema";

/** Any change to this value changes every generated row. */
const SEED = 20_260_101;

/** End of the synthetic transaction window. */
const REFERENCE_DATE = new Date("2026-10-25T00:00:00.000Z");
const WINDOW_DAYS = 90;
const WINDOW_START = new Date(
  REFERENCE_DATE.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
);

const TARGET_TXNS = 50_000;
const CUSTOMER_COUNT = 2_000;
const INSERT_BATCH = 1_000;

/* -------------------------------------------------------------------------- */
/* Reference data                                                            */
/* -------------------------------------------------------------------------- */

/** Branch names in the "City - Locality" form Indian banks tend to use. */
const BRANCHES = [
  "Mumbai - Fort",
  "Mumbai - Andheri East",
  "Navi Mumbai - Vashi",
  "Delhi - Connaught Place",
  "Delhi - Karol Bagh",
  "Gurugram - Cyber City",
  "Noida - Sector 62",
  "Bengaluru - Koramangala",
  "Bengaluru - Whitefield",
  "Chennai - T Nagar",
  "Chennai - Anna Nagar",
  "Hyderabad - Banjara Hills",
  "Hyderabad - Gachibowli",
  "Kolkata - Park Street",
  "Kolkata - Salt Lake",
  "Pune - Kothrud",
  "Pune - Hinjewadi",
  "Ahmedabad - Navrangpura",
  "Jaipur - MI Road",
  "Lucknow - Hazratganj",
  "Chandigarh - Sector 17",
  "Kochi - MG Road",
  "Indore - Vijay Nagar",
  "Coimbatore - RS Puram",
  "Bhubaneswar - Saheed Nagar",
] as const;

/** Corridors used for cross-border transfers. */
const FOREIGN_COUNTRIES = ["AE", "US", "GB", "SG", "NP", "LK", "HK"] as const;

type TxnType = NewTransaction["type"];
type TxnChannel = NewTransaction["channel"];

/** Channels that make sense for each transaction type. */
const CHANNELS_BY_TYPE: Record<TxnType, readonly TxnChannel[]> = {
  cash_deposit: ["branch", "atm"],
  cash_withdrawal: ["atm", "branch"],
  transfer: ["internet", "mobile", "branch"],
  upi: ["mobile"],
  card: ["internet", "mobile"],
  loan_disbursal: ["branch"],
};

/** Rough mix of traffic, weighted towards retail payments. */
const TYPE_WEIGHTS: ReadonlyArray<{ value: TxnType; weight: number }> = [
  { value: "upi", weight: 40 },
  { value: "card", weight: 20 },
  { value: "transfer", weight: 18 },
  { value: "cash_withdrawal", weight: 12 },
  { value: "cash_deposit", weight: 8 },
  { value: "loan_disbursal", weight: 2 },
];

/* -------------------------------------------------------------------------- */
/* Rules                                                                      */
/* -------------------------------------------------------------------------- */

interface SeedRule {
  code: string;
  name: string;
  description: string;
  category: "aml" | "kyc" | "lending" | "fraud";
  /** The amount threshold, kept separately so probe rows can straddle it. */
  threshold: number;
  /** Transaction shape that makes this rule fire, for probe rows. */
  fires: { type: TxnType; channel?: TxnChannel; foreignCountry?: boolean };
  jsonLogic: RuleLogic;
}

const SEED_RULES: readonly SeedRule[] = [
  {
    code: "R-101",
    name: "Large cash deposit",
    description:
      "Cash deposits of ₹10,00,000 or more in INR, reportable as a cash transaction.",
    category: "aml",
    threshold: 1_000_000,
    fires: { type: "cash_deposit", channel: "branch" },
    jsonLogic: {
      and: [
        { "==": [{ var: "type" }, "cash_deposit"] },
        { "==": [{ var: "currency" }, "INR"] },
        { ">=": [{ var: "amount" }, 1_000_000] },
      ],
    },
  },
  {
    code: "R-102",
    name: "Cross-border transfer",
    description:
      "Outbound transfers to a country other than India of ₹5,00,000 or more.",
    category: "aml",
    threshold: 500_000,
    fires: { type: "transfer", channel: "internet", foreignCountry: true },
    jsonLogic: {
      and: [
        { "==": [{ var: "type" }, "transfer"] },
        { "!=": [{ var: "country" }, "IN"] },
        { ">=": [{ var: "amount" }, 500_000] },
      ],
    },
  },
  {
    code: "R-103",
    name: "High-value UPI payment",
    description: "UPI payments of ₹2,00,000 or more, well above the usual cap.",
    category: "fraud",
    threshold: 200_000,
    fires: { type: "upi", channel: "mobile" },
    jsonLogic: {
      and: [
        { "==": [{ var: "type" }, "upi"] },
        { ">=": [{ var: "amount" }, 200_000] },
      ],
    },
  },
  {
    code: "R-104",
    name: "Large loan disbursal",
    description: "Loan disbursals of ₹25,00,000 or more require senior sign-off.",
    category: "lending",
    threshold: 2_500_000,
    fires: { type: "loan_disbursal", channel: "branch" },
    jsonLogic: {
      and: [
        { "==": [{ var: "type" }, "loan_disbursal"] },
        { ">=": [{ var: "amount" }, 2_500_000] },
      ],
    },
  },
  {
    code: "R-105",
    name: "Large ATM withdrawal",
    description:
      "ATM cash withdrawals of ₹1,00,000 or more, where KYC refresh may be due.",
    category: "kyc",
    threshold: 100_000,
    fires: { type: "cash_withdrawal", channel: "atm" },
    jsonLogic: {
      and: [
        { "==": [{ var: "type" }, "cash_withdrawal"] },
        { "==": [{ var: "channel" }, "atm"] },
        { ">=": [{ var: "amount" }, 100_000] },
      ],
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

const DEMO_USERS: ReadonlyArray<{
  email: string;
  name: string;
  role: UserRole;
}> = [
  { email: "officer@ruleforge.demo", name: "Asha Officer", role: "officer" },
  { email: "head@ruleforge.demo", name: "Ravi Head", role: "head" },
  { email: "ops@ruleforge.demo", name: "Meera Ops", role: "ops" },
  { email: "auditor@ruleforge.demo", name: "Imran Auditor", role: "auditor" },
];

async function seedUsers(password: string) {
  const emails = DEMO_USERS.map((u) => u.email);
  const existing = await db
    .select({ email: user.email })
    .from(user)
    .where(inArray(user.email, emails));
  const present = new Set(existing.map((row) => row.email));

  let created = 0;
  for (const demo of DEMO_USERS) {
    if (!present.has(demo.email)) {
      await auth.api.signUpEmail({
        body: { email: demo.email, password, name: demo.name },
      });
      created += 1;
    }

    // `role` is `input: false` in the auth config, so sign-up cannot set it.
    // It is assigned here, directly, and re-asserted on every run.
    await db
      .update(user)
      .set({ role: demo.role })
      .where(eq(user.email, demo.email));
  }

  return { created, skipped: DEMO_USERS.length - created };
}

/* -------------------------------------------------------------------------- */
/* Rules and versions                                                         */
/* -------------------------------------------------------------------------- */

async function seedRules() {
  let rulesCreated = 0;
  let versionsCreated = 0;

  for (const spec of SEED_RULES) {
    // The seed is held to the same guardrail as an agent: a rule that breaks
    // the contract must not reach the database, even from our own fixtures.
    const logic = assertRule(spec.jsonLogic);

    const inserted = await db
      .insert(rules)
      .values({
        code: spec.code,
        name: spec.name,
        description: spec.description,
        category: spec.category,
      })
      .onConflictDoNothing({ target: rules.code })
      .returning({ id: rules.id });

    if (inserted.length > 0) rulesCreated += 1;

    const [rule] = inserted.length
      ? inserted
      : await db
          .select({ id: rules.id })
          .from(rules)
          .where(eq(rules.code, spec.code))
          .limit(1);

    const insertedVersion = await db
      .insert(ruleVersions)
      .values({
        ruleId: rule.id,
        version: 1,
        jsonLogic: logic as RulesLogic,
        status: "live",
        changeSummary: "Initial version seeded with the demo dataset.",
        createdByAgent: "seed",
      })
      .onConflictDoNothing({
        target: [ruleVersions.ruleId, ruleVersions.version],
      })
      .returning({ id: ruleVersions.id });

    if (insertedVersion.length > 0) versionsCreated += 1;

    const [version] = insertedVersion.length
      ? insertedVersion
      : await db
          .select({ id: ruleVersions.id })
          .from(ruleVersions)
          .where(eq(ruleVersions.ruleId, rule.id))
          .limit(1);

    await db
      .update(rules)
      .set({ currentVersionId: version.id })
      .where(eq(rules.id, rule.id));
  }

  return { rulesCreated, versionsCreated };
}

/* -------------------------------------------------------------------------- */
/* Transactions                                                               */
/* -------------------------------------------------------------------------- */

const customerIds = Array.from(
  { length: CUSTOMER_COUNT },
  (_, i) => `CUST-${String(i + 1).padStart(6, "0")}`,
);

function randomTimestamp(): Date {
  return faker.date.between({ from: WINDOW_START, to: REFERENCE_DATE });
}

function money(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Amounts that sit either side of a threshold, so moving the threshold in a
 * backtest produces a visible difference instead of a silent zero.
 *
 * For a threshold T this covers T itself, T±1, the same around T/2 (the band a
 * halved threshold would newly catch) and T×2.
 */
function probeAmounts(threshold: number): number[] {
  const half = Math.floor(threshold / 2);
  return [
    threshold - 1,
    threshold,
    threshold + 1,
    half - 1,
    half,
    half + 1,
    Math.floor(threshold * 0.75),
    threshold * 2,
  ];
}

/** Rows deliberately placed around each rule's threshold. */
function buildProbeRows(): NewTransaction[] {
  const rows: NewTransaction[] = [];

  for (const spec of SEED_RULES) {
    for (const amount of probeAmounts(spec.threshold)) {
      // A few customers per probe amount, so `customers_affected` is non-trivial.
      for (let i = 0; i < 3; i += 1) {
        const channel =
          spec.fires.channel ?? faker.helpers.arrayElement(CHANNELS_BY_TYPE[spec.fires.type]);
        rows.push({
          id: faker.string.uuid(),
          customerId: faker.helpers.arrayElement(customerIds),
          amount: money(amount),
          currency: "INR",
          type: spec.fires.type,
          channel,
          branch: faker.helpers.arrayElement(BRANCHES),
          country: spec.fires.foreignCountry
            ? faker.helpers.arrayElement(FOREIGN_COUNTRIES)
            : "IN",
          timestamp: randomTimestamp(),
        });
      }
    }
  }

  return rows;
}

/** A plausible amount: mostly small retail values, occasionally very large. */
function randomAmount(type: TxnType): number {
  if (type === "loan_disbursal") {
    return faker.number.int({ min: 50_000, max: 5_000_000 });
  }

  const bucket = faker.number.int({ min: 1, max: 100 });
  if (bucket <= 70) return faker.number.int({ min: 50, max: 25_000 });
  if (bucket <= 90) return faker.number.int({ min: 25_000, max: 200_000 });
  if (bucket <= 98) return faker.number.int({ min: 200_000, max: 1_200_000 });
  return faker.number.int({ min: 1_200_000, max: 6_000_000 });
}

function buildRandomRow(): NewTransaction {
  const type = faker.helpers.weightedArrayElement(TYPE_WEIGHTS);
  const channel = faker.helpers.arrayElement(CHANNELS_BY_TYPE[type]);
  const isForeign = type === "transfer" && faker.number.int({ min: 1, max: 100 }) <= 12;

  return {
    id: faker.string.uuid(),
    customerId: faker.helpers.arrayElement(customerIds),
    amount: money(randomAmount(type)),
    currency: "INR",
    type,
    channel,
    branch:
      channel === "branch" || channel === "atm"
        ? faker.helpers.arrayElement(BRANCHES)
        : null,
    country: isForeign ? faker.helpers.arrayElement(FOREIGN_COUNTRIES) : "IN",
    timestamp: randomTimestamp(),
  };
}

async function seedTransactions() {
  const probes = buildProbeRows();
  const rows: NewTransaction[] = [...probes];
  while (rows.length < TARGET_TXNS) {
    rows.push(buildRandomRow());
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    const result = await db
      .insert(transactions)
      .values(batch)
      .onConflictDoNothing({ target: transactions.id })
      .returning({ id: transactions.id });
    inserted += result.length;
    process.stdout.write(
      `\r  transactions: ${Math.min(i + INSERT_BATCH, rows.length)}/${rows.length}`,
    );
  }
  process.stdout.write("\n");

  return { generated: rows.length, inserted, probes: probes.length };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

async function main() {
  const password = env.DEMO_PASSWORD;
  if (!password) {
    throw new Error(
      "DEMO_PASSWORD is not set. Add it to .env.local (at least 8 characters) and re-run.",
    );
  }

  faker.seed(SEED);

  console.log("Seeding RuleForge AI demo data");
  console.log(`  faker seed:     ${SEED}`);
  console.log(
    `  txn window:     ${WINDOW_START.toISOString().slice(0, 10)} → ${REFERENCE_DATE.toISOString().slice(0, 10)} (${WINDOW_DAYS} days)`,
  );

  const users = await seedUsers(password);
  const ruleCounts = await seedRules();
  const txnCounts = await seedTransactions();

  const [{ count: txnTotal }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions);
  const [{ count: customerTotal }] = await db
    .select({ count: sql<number>`count(distinct ${transactions.customerId})::int` })
    .from(transactions);
  const [{ count: ruleTotal }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rules);
  const [{ count: liveVersions }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ruleVersions)
    .where(eq(ruleVersions.status, "live"));

  console.log("\nSeed summary");
  console.log("  users");
  console.log(`    created:            ${users.created}`);
  console.log(`    already present:    ${users.skipped}`);
  console.log(`    roles assigned:     ${USER_ROLES.join(", ")}`);
  console.log("  rules");
  console.log(`    created:            ${ruleCounts.rulesCreated}`);
  console.log(`    versions created:   ${ruleCounts.versionsCreated}`);
  console.log(`    rules in database:  ${ruleTotal}`);
  console.log(`    live versions:      ${liveVersions}`);
  console.log("  transactions");
  console.log(`    generated:          ${txnCounts.generated}`);
  console.log(`    of which probes:    ${txnCounts.probes} (straddling thresholds)`);
  console.log(`    newly inserted:     ${txnCounts.inserted}`);
  console.log(`    already present:    ${txnCounts.generated - txnCounts.inserted}`);
  console.log(`    rows in database:   ${txnTotal}`);
  console.log(`    distinct customers: ${customerTotal}`);
  console.log(`\n  demo login password comes from DEMO_PASSWORD in .env.local`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nSeed failed:");
    console.error(error);
    process.exit(1);
  });
