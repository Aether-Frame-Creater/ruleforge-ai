# RuleForge AI — System Architecture & Onboarding Manual

RuleForge AI is an automated multi-agent regulatory compliance engine built for financial institutions. It ingests regulatory circulars (PDFs), extracts verifiable legal obligations, drafts deterministic transaction-monitoring rules, backtests those rules against transaction histories, subjects drafts to an adversarial challenger review, and delivers immutable audit trails to human compliance officers under strict maker-checker governance.

---

## 1. Core Operating Invariant

> **Agents never approve or deploy rules.**
> The pipeline orchestrator writes exactly one status for rule versions: `draft`. Promotion to `submitted`, `approved`, `shadow`, or `live` is strictly reserved for human officers via authenticated maker-checker server actions.

---

## 2. Technology Stack

| Layer | Component | Details |
|---|---|---|
| **Framework** | Next.js 16.4 (App Router, Turbopack, TypeScript 5) | React 19.3, Server Components & Server Actions |
| **Database** | Neon Serverless PostgreSQL | `pgvector` enabled (768-dimensional embeddings) |
| **ORM & Migrations** | Drizzle ORM `0.45` & Drizzle Kit `0.31` | Custom PostgreSQL triggers in `src/db/sql/guards.sql` |
| **Authentication** | Better Auth `1.7` (Drizzle Adapter) | Role-Based Access Control (`officer`, `head`, `ops`, `auditor`) |
| **Agent Framework** | `@google/adk` (Google Agent Development Kit) | A2A message envelopes, typed agents, state machine |
| **Language Models** | `@google/genai` (Gemini API) | Primary: `gemini-3.5-flash` · Triage: `gemini-3.5-flash-lite` |
| **Rule Engine** | `json-logic-js` | Constrained execution sandbox with strict AST validation |
| **Synthetic Data** | `@faker-js/faker` | Transaction generators for 30-day realistic backtesting windows |
| **UI Components** | Tailwind CSS v4, shadcn/ui (`nova` preset), Radix UI, Recharts, Lucide | Dark/light theme support (`next-themes`), Sonner toasts |

---

## 3. Directory Layout & File Responsibilities

```
ruleforge-ai/
├── src/
│   ├── agents/                     # Multi-agent circular analysis pipeline
│   │   ├── orchestrator.ts         # Deterministic state machine coordinating the agents
│   │   ├── intake-agent.ts         # PDF parsing, metadata extraction & paragraph chunking
│   │   ├── embeddings.ts           # Neon pgvector chunk ingestion & semantic indexing
│   │   ├── applicability-agent.ts  # Triage: checks circular relevance against bank profile
│   │   ├── bank-profile.ts         # Static institution charter, licences, and operational scope
│   │   ├── obligation-agent.ts     # Extracts actionable obligations with paragraph references
│   │   ├── mapping-agent.ts        # Maps obligations to existing rules or flags new rule needs
│   │   ├── rule-author-agent.ts    # Drafts json-logic rules with iterative self-repair
│   │   ├── impact-agent.ts         # Summarizes backtest risk levels and customer impact
│   │   ├── challenger-agent.ts     # Adversarial review against original circular text
│   │   ├── runtime.ts              # Budgets, timeouts, rate limits, retry policies & A2A envelopes
│   │   ├── llm-cache.ts            # Local disk cache for Gemini API requests/replay
│   │   └── types.ts                # CaseFile, A2AEnvelope, and shared agent interfaces
│   ├── app/                        # Next.js App Router (Routes & Server Pages)
│   │   ├── (app)/                  # Authenticated application shell
│   │   │   ├── dashboard/          # Platform overview metrics and active circular queues
│   │   │   ├── circulars/          # Circular management, uploads & progress timelines
│   │   │   ├── circulars/[id]/     # Deep-dive circular view (chunks, obligations, agent runs)
│   │   │   ├── rules/              # Rule catalog, versions, JSON logic & plain-English view
│   │   │   ├── drafts/[versionId]/ # Draft review interface (backtest diff, challenger findings)
│   │   │   ├── approvals/          # Maker-checker approval queue for Head of Compliance
│   │   │   └── audit/              # Immutable audit trail explorer & rule lineage graphs
│   │   ├── api/                    # HTTP endpoints (Better Auth handler, runs stream)
│   │   └── login/                  # Authentication page with demo quick-login switcher
│   ├── components/                 # React UI components
│   │   ├── app/                    # Domain-specific components (agent timeline, draft review)
│   │   └── ui/                     # Primitives from shadcn/ui
│   ├── db/                         # Database layer
│   │   ├── schema.ts               # Drizzle table definitions, relations, and enums
│   │   ├── auth-schema.ts          # Better Auth tables (user, session, account, verification)
│   │   ├── seed.ts                 # Database seeder (demo users, baseline rules, transactions)
│   │   ├── extensions.sql          # Extension bootstrapper (`CREATE EXTENSION vector;`)
│   │   └── sql/guards.sql          # DB-level immutability triggers and check constraints
│   ├── lib/                        # Shared utility libraries
│   │   ├── actions/                # Next.js Server Actions (circulars, approvals, auth)
│   │   ├── ai/                     # Gemini client configuration & model bindings
│   │   ├── auth/                   # Better Auth server instance, browser client & RBAC guards
│   │   ├── db/                     # Drizzle database client bound to Neon pooler
│   │   ├── env.ts                  # Zod-validated environment configuration
│   │   └── queries.ts              # Read-only database queries for server components
│   └── rules/                      # The Deterministic Rule Engine
│       ├── schema.ts               # AST contract, SAFE_OPERATORS & RULE_FIELDS allowlist
│       ├── engine.ts               # Compiler, evaluator, English explainer & structural diff
│       └── backtest.ts             # Keyset-paginated replay runner over historical transactions
├── scripts/                        # Operational CLI tools
│   ├── run-pipeline.ts             # CLI entrypoint to execute the multi-agent pipeline on a PDF
│   ├── check-rules.ts              # Validation suite testing AST rules, contracts & backtesting
│   ├── demo-reset.ts               # Flushes transient runs, circulars and restores seed baseline
│   ├── make-demo-circular.ts       # Generates synthetic PDF test circulars using `pdf-lib`
│   ├── e2e-browser.mjs             # Playwright browser end-to-end test suite
│   └── run-sql.mjs                 # Helper script executing raw SQL scripts (used for guards.sql)
├── storage/                        # Storage directories (git-ignored)
│   ├── circulars/                  # Uploaded PDF binary storage
│   ├── llm-cache/                  # Cached Gemini prompt/completion envelopes
│   └── e2e/                        # Playwright test screenshots
└── samples/                        # Checked-in synthetic sample circulars
```

---

## 4. The 9-Stage Multi-Agent Pipeline

The orchestrator (`src/agents/orchestrator.ts`) is a typed state machine. It does not allow agents to freestyle workflow routing.

```
                      [ Upload Regulatory PDF ]
                                  │
                                  ▼
                     ┌─────────────────────────┐
                     │   Stage 1: Intake Agent │ (gemini-3.5-flash-lite)
                     │ - Text extraction       │
                     │ - Paragraph numbering   │
                     └────────────┬────────────┘
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
┌──────────────────────────────┐        ┌───────────────────────────────────┐
│ Stage 2: Embedding Ingestion │        │ Stage 3: Applicability Agent      │ (gemini-3.5-flash-lite)
│ - Store circular_chunks      │        │ - Compare vs Bank Profile         │
│ - Neon pgvector (768 dims)   │        │ - Exit if 'not_applicable'        │
└──────────────────────────────┘        └─────────────────┬─────────────────┘
                                                          │ (Applicable)
                                                          ▼
                                        ┌───────────────────────────────────┐
                                        │ Stage 4: Obligation Agent         │ (gemini-3.5-flash)
                                        │ - Extract mandates & deadlines    │
                                        │ - Mandatory verbatim quote check  │
                                        └─────────────────┬─────────────────┘
                                                          │
                                                          ▼
                                        ┌───────────────────────────────────┐
                                        │ Stage 5: Mapping Agent            │ (gemini-3.5-flash)
                                        │ - modify_existing / new_rule /    │
                                        │   no_rule_change                  │
                                        └─────────────────┬─────────────────┘
                                                          │
                                                          ▼
                                        ┌───────────────────────────────────┐
                                        │ Stage 6: Rule Author Agent        │ (gemini-3.5-flash)
                                        │ - Write json-logic AST            │
                                        │ - Self-repair syntax (max 3 tries)│
                                        └───────────┬───────────▲───────────┘
                                                    │           │
                                                    ▼           │ (Objection Loop:
                                        ┌───────────────────┐   │  Max 2 Rounds)
                                        │ Stage 7: Backtest │   │
                                        │ - Deterministic   │   │
                                        │ - Delta vs live   │   │
                                        └───────────┬───────┘   │
                                                    │           │
                         ┌──────────────────────────┴───────────┼──────────────────────────┐
                         ▼                                                                 ▼
        ┌───────────────────────────────────┐                             ┌───────────────────────────────────┐
        │ Stage 8: Impact Agent             │ (flash-lite)                │ Stage 9: Challenger Agent         │ (gemini-3.5-flash)
        │ - Summarize volume changes        │                             │ - Adversarial check vs paragraph  │
        │ - Risk score (low/med/high/crit)  │                             │ - Pass or emit objections         │
        └─────────────────┬─────────────────┘                             └─────────────────┬─────────────────┘
                          │                                                                 │
                          └─────────────────────────────┬───────────────────────────────────┘
                                                        │
                                                        ▼
                                       ┌───────────────────────────────────┐
                                       │ Human Review Phase                │
                                       │ - Status: 'draft'                 │
                                       │ - Maker submits -> Checker signs  │
                                       └───────────────────────────────────┘
```

### Stage Details & Safeguards

1. **Intake Agent (`intake-agent.ts`)**: Reads raw PDF bytes inline. Dissects the circular into numbered paragraphs (`§1`, `§2`, etc.), extracting document title, issuing regulator (`rbi`, `sebi`, `irdai`, `fiu_ind`), circular number, and date.
2. **Embeddings (`embeddings.ts`)**: Batches paragraph texts into Gemini text-embedding models (768 dimensions) and inserts them into `circular_chunks` with pgvector indexes for similarity lookup.
3. **Applicability Agent (`applicability-agent.ts`)**: Evaluates the circular against the hardcoded `BankProfile` (`src/agents/bank-profile.ts`). If the institution's charter or jurisdiction is exempt, the pipeline halts immediately with status `not_applicable` and audits the rationale.
4. **Obligation Extraction & The Quote Gate (`obligation-agent.ts`)**:
   - Obligations must include a precise paragraph citation and a verbatim quote.
   - **Anti-Hallucination Gate (`quoteAppearsIn`)**: Validated in pure TypeScript code by searching for the quote within the cited paragraph after whitespace/punctuation normalization. If a quote cannot be resolved to the text, the obligation is dropped immediately and logged to `audit_log`. It is never auto-repaired or assumed.
5. **Mapping Agent (`mapping-agent.ts`)**: Compares active production rules against extracted obligations to decide whether to update an existing rule (`modify_existing`), create a fresh rule (`new_rule`), or classify as a procedural manual control (`no_rule_change`).
6. **Rule Author Agent (`rule-author-agent.ts`)**:
   - Generates executable rules in JSON-Logic format.
   - Enforces the strict rule schema contract (`validateRule`). If the model uses invalid syntax or hallucinated fields, the error feedback is piped back into the author agent (up to 3 iterative repair attempts).
7. **Deterministic Backtest Tool (`src/rules/backtest.ts`)**:
   - Not an LLM. Pure compiled code.
   - Replays candidate rule vs baseline live rule across stored transaction records (`transactions` table) using keyset pagination (`BACKTEST_BATCH_SIZE = 5,000`).
   - Tallies: `old_alerts`, `new_alerts`, `alerts_added`, `alerts_removed`, `customers_affected`, and captures 10 concrete transaction IDs where outcomes shifted.
8. **Impact Agent (`impact-agent.ts`)**: Consumes the backtest numbers and translates them into an executive summary with a categorical risk level (`low`, `medium`, `high`, `critical`).
9. **Challenger Agent (`challenger-agent.ts`)**:
   - Operates as an independent adversarial reviewer. Checks the drafted logic against the source paragraph to spot over-compliance, under-compliance, or misinterpretation.
   - If the challenger rejects the draft, the pipeline loops back to Stage 6 with specific objections (capped at `MAX_CHALLENGER_ROUNDS = 2`).
   - If a draft fails round 2, it is not deleted: it is stored as `draft`, flagged with `needsHumanAttention = true`, and presented to human compliance officers with the full debate history.

---

## 5. Rule Security Contract & Execution Engine

Language models are never allowed to execute arbitrary code. Rules are written as restricted ASTs evaluated through `src/rules/engine.ts`.

### Safe Operator Allowlist
Only these 11 operators are permitted:
```typescript
export const SAFE_OPERATORS = [
  "and", "or", "!", "==", "!=", ">", ">=", "<", "<=", "in", "var"
] as const;
```
*Forbidden by design:*
- No arithmetic (`+`, `-`, `*`, `/`) to prevent rounding errors and unit mismatches in financial calculations.
- No conditionals (`if`, `?:`) to prevent nested branching complexity.
- No string mutators or higher-order array filters (`map`, `reduce`, `cat`, `substr`).

### Transaction Field Allowlist
Rules can only inspect these fields:
```typescript
export const RULE_FIELDS = [
  "amount",       // numeric (coerced to float during evaluation)
  "currency",     // ISO 4217 code (e.g., 'INR', 'USD')
  "type",         // transaction type (e.g., 'cash_deposit', 'wire_transfer')
  "channel",      // transfer mechanism ('branch', 'atm', 'rtgs', 'neft', 'upi')
  "branch",       // branch identifier or null
  "country",      // destination/origin ISO country code
  "customer_id"   // unique account/customer identifier
] as const;
```

### Engine Capabilities
- **`compileRule(logic)`**: Compiles AST into an optimized evaluator function `(txn) => boolean`.
- **`explainRule(logic)`**: Converts JSON-Logic AST into human-readable English for auditors (e.g., `"amount > 50,000 AND channel is in ['atm', 'branch']"`).
- **`diffRules(baseline, candidate)`**: Calculates structural differences between versions to highlight modified thresholds or added constraints.

---

## 6. Access Control & Maker-Checker Architecture

Four discrete roles govern the system (`src/lib/auth/guards.ts`):

| Role | Name | Responsibilities | Permissions |
|---|---|---|---|
| `officer` | Compliance Officer | Day-to-day regulatory ingestion & triage | Upload circulars, review obligations, submit drafts |
| `head` | Head of Compliance | Oversight & executive sign-off | Approve or reject submitted drafts |
| `ops` | Operations | Production runtime operations | View active rules, audit runs, inspect shadow state |
| `auditor` | Auditor | External / Internal audit review | Read-only access across system + full audit logs |

### Maker-Checker Enforcement
- An officer creates and submits a draft (`rule_versions.status = 'submitted'`).
- The draft moves to the `/approvals` queue.
- **The submission user cannot be the approver.** This rule is verified twice:
  1. In the server action (`src/lib/actions/approval-actions.ts`):
     ```typescript
     if (version.submittedBy === user.id) {
       return failure("You submitted this draft, so you cannot also approve it.");
     }
     ```
  2. In the PostgreSQL schema constraint:
     ```sql
     CHECK (maker_id != checker_id)
     ```

### Immutable Database-Level Audit Trail
Defined in `src/db/sql/guards.sql`:
- The `audit_log` table is append-only.
- Statement-level database triggers (`audit_log_no_update_or_delete` and `audit_log_no_truncate`) reject any `UPDATE`, `DELETE`, or `TRUNCATE` operations on `audit_log`, even if executed directly via raw SQL queries by the database user.

---

## 7. Data Models & Database Schema

Defined in `src/db/schema.ts`:

- **`circulars`**: Ingested regulatory documents with regulator metadata, PDF disk path, applicability reasoning, and lifecycle status (`uploaded` → `analysing` → `review` / `not_applicable` → `approved`).
- **`circular_chunks`**: Paragraph-level chunks linked to the circular, containing raw text and 768-dimensional `vector(768)` embeddings.
- **`obligations`**: Discrete mandates extracted by agents, storing summary, type, deadline, verification status, and foreign key to `circular_chunks`.
- **`rules`**: Top-level rule definition with code (e.g., `R-101`), category (`aml`, `kyc`, `lending`, `fraud`), and name.
- **`rule_versions`**: Immutable rule iterations with version integer, AST JSON logic, change summary, submitter metadata, challenger findings, and status.
- **`transactions`**: High-volume mock/production transactions against which backtests run.
- **`backtest_runs`**: Replay metrics recording alert counts, added/removed alerts, affected customer tallies, and delta samples.
- **`approvals`**: Maker-checker audit rows logging maker ID, checker ID, decision (`approved` / `rejected`), and mandatory justification comment.
- **`agent_runs`**: Chronological log of every model/tool interaction, input/output JSON, token counts, execution duration, and A2A envelopes.
- **`audit_log`**: System-wide tamper-evident timeline for all entity events.

---

## 8. Development & Operational Commands

All core tasks have dedicated npm scripts:

```bash
# Development & Build
npm run dev               # Start Next.js development server (Turbopack)
npm run build             # Build optimized production bundle
npm run typecheck         # Run TypeScript checks (tsc --noEmit)
npm run lint              # Run ESLint validation

# Database Management
npm run db:sync           # Apply schema changes (db:push) and re-install SQL guards (db:guards)
npm run db:seed           # Populate demo accounts, initial baseline rules, and 30k transactions
npm run db:studio         # Open Drizzle Studio visual database explorer
npm run auth:generate     # Re-generate Better Auth schema if auth config changes

# Pipeline & Verification
npm run check:rules       # Verify AST contract validation, English explainer, and backtesting
npm run agents:run -- <path-to-pdf> # Run the 9-stage pipeline from CLI on a circular PDF
npm run demo:reset        # Reset database to clean post-seed state (clears transient pipeline runs)
npm run demo:circular     # Re-generate synthetic sample PDF (samples/circulars/demo-aml-cash-threshold.pdf)
```

> **Warning on Database Sync:** Always use `npm run db:sync` rather than bare `npm run db:push`. A raw `db:push` drops the PostgreSQL triggers and check constraints installed by `src/db/sql/guards.sql`.

---

## 9. Model Modes & Offline Replay

Configured via `LLM_MODE` in `.env.local`:

- `cache` *(default)*: Read-through cache. If an identical prompt exists under `storage/llm-cache/`, it serves the cached response without hitting the Google Gemini API. New prompts make live API calls and persist to disk.
- `replay`: Pure offline mode. Never hits the API; fails if a response is not already stored. Perfect for running demos or tests without API keys or quota consumption.
- `live`: Bypasses existing cache files, always executes live Gemini calls, and updates disk cache.
- `record`: Always hits the API and saves output.

---

## 10. Teammate Quickstart Walkthrough

To bring a local environment up from scratch:

1. **Clone repository and configure environment:**
   ```bash
   cp .env.example .env.local
   ```
   Provide valid values in `.env.local`:
   - `DATABASE_URL` / `DATABASE_URL_UNPOOLED`: Neon Postgres database with pgvector enabled.
   - `GOOGLE_API_KEY`: API key from Google AI Studio.
   - `BETTER_AUTH_SECRET`: Random 32+ character string.
   - `DEMO_MODE="true"`: Enables fast login switching for local development.

2. **Initialize Database Extensions & Schema:**
   Ensure `CREATE EXTENSION IF NOT EXISTS vector;` has been run on your Neon instance, then execute:
   ```bash
   npm run db:sync
   ```

3. **Seed Baseline Data:**
   ```bash
   npm run db:seed
   ```
   *Seeded Demo Accounts (default password set in `.env.local`):*
   - Officer: `officer@ruleforge.demo`
   - Head of Compliance: `head@ruleforge.demo`
   - Operations: `ops@ruleforge.demo`
   - Auditor: `auditor@ruleforge.demo`

4. **Run Engine Verification:**
   ```bash
   npm run check:rules
   ```

5. **Test Circular Pipeline via CLI:**
   ```bash
   npm run agents:run -- samples/circulars/demo-aml-cash-threshold.pdf
   ```

6. **Start Dev Server:**
   ```bash
   npm run dev
   ```
   Navigate to `http://localhost:3000`. Log in as `officer@ruleforge.demo` to upload circulars or inspect pipeline traces, and switch to `head@ruleforge.demo` to exercise the maker-checker approvals.
