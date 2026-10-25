# RuleForge AI

Multi-agent regulatory compliance tooling for banks. The intended pipeline:

1. Ingest a regulatory circular (PDF).
2. Extract discrete, citable obligations from it.
3. Draft JSON rule changes that satisfy those obligations.
4. Backtest the draft rules against synthetic transactions.
5. Require explicit human approval before anything is deployed.

**Status: scaffold.** Dependencies, configuration and minimal integrations only —
no agent logic, rule engine, backtesting, auth flows, schema or UI yet.

## Stack

| Concern    | Choice                                                  |
| ---------- | ------------------------------------------------------- |
| Framework  | Next.js 16 (App Router, TypeScript, Turbopack)          |
| Styling    | Tailwind CSS v4 + shadcn/ui (radix base, `nova` preset) |
| Database   | Neon PostgreSQL + pgvector, Drizzle ORM                 |
| Auth       | Better Auth (Drizzle adapter)                           |
| Agents     | Google ADK for TypeScript (`@google/adk`)               |
| Model      | Gemini via `@google/genai` (Google AI Studio key)       |
| Validation | Zod v4                                                  |
| Rules      | `json-logic-js`                                         |
| Test data  | `@faker-js/faker`                                       |

## Getting started

```bash
cp .env.example .env.local   # then fill in the values
npm run dev
```

Before the first migration, enable pgvector on the Neon database
(`src/db/extensions.sql`):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Layout

```
src/
  app/          Next.js App Router
  components/   UI (components/ui is shadcn-generated)
  lib/
    ai/         Gemini client
    auth/       Better Auth instance + browser client
    db/         Drizzle client bound to Neon
    env.ts      Zod-validated environment variables
  agents/       The circular pipeline (ADK agents + orchestrator)
  rules/        Rule contract, engine and backtester
  db/           Drizzle schema, seed, extensions.sql, sql/guards.sql
scripts/        CLI entry points (pipeline run, seed helpers, checks)
samples/        Synthetic demo documents
storage/        Uploaded circular PDFs (git-ignored)
```

## The circular pipeline

`runCircularPipeline(circularId)` in `src/agents/orchestrator.ts` is a plain
TypeScript state machine. It takes an uploaded PDF and produces **draft** rule
versions with backtests and an independent review, then hands over to a human.

| Step | Agent                 | Model | Does                                                           |
| ---- | --------------------- | ----- | -------------------------------------------------------------- |
| 1    | `intake_agent`        | LITE  | Reads the PDF inline; returns metadata + numbered paragraphs     |
| 2    | —                     | —     | Stores paragraphs in `circular_chunks` with 768-dim embeddings   |
| 3    | `applicability_agent` | LITE  | Does this circular bind our bank profile?                        |
| 4    | `obligation_agent`    | MAIN  | Extracts obligations, each with a paragraph ref + exact quote    |
| 5    | `mapping_agent`       | MAIN  | Modify an existing rule / new rule / no rule change              |
| 6    | `rule_author_agent`   | MAIN  | Writes json-logic; retried against `validateRule` (max 3)        |
| 7    | `backtest_tool`       | none  | `runBacktest(candidate vs live)` — code, not a model             |
| 8    | `impact_agent`        | LITE  | Plain-English impact + risk level from the backtest numbers      |
| 9    | `challenger_agent`    | MAIN  | Independent review against the source paragraph (max 2 rounds)   |

Routing: not applicable → `not_applicable` and stop; no verified obligations →
stop with a reason; every obligation mapped to "no rule change" → stop with a
reason; challenger fail → back to the author, and after the last round the draft
is kept but flagged for human attention; success → circular status `review`.

**Agents cannot approve anything.** The only `rule_versions.status` the
orchestrator writes is `draft`. Promotion to `approved`, `shadow` or `live` is a
human maker-checker action that exists nowhere in this code path.

### Anti-hallucination check

Every obligation must quote its source paragraph. The quote is then verified
*in code* (`quoteAppearsIn`, in `src/agents/obligation-agent.ts`) against the
paragraph it cites, after normalising typography only. An obligation whose quote
cannot be found is dropped and written to `audit_log` — never repaired.

### Guardrails

- Circular text is fenced in `<<<UNTRUSTED_DOCUMENT>>>` blocks and every agent
  carries a security preamble telling it the fenced text is data, not orders.
- Per-run budget: LLM calls, total tokens and a per-agent timeout
  (`DEFAULT_BUDGET` in `src/agents/runtime.ts`), failing with a clear error.
- Gemini 429/503/500 are retried with exponential backoff and jitter.
- Every agent call is a row in `agent_runs` (input, output, status, timing) and
  status changes, drafts and dropped obligations are written to `audit_log`.

### Why the challenger runs in-process, not over A2A

Agents exchange A2A-shaped envelopes — `{ from, to, type, payload, timestamp }`,
persisted on each `agent_runs` row — but the challenger is invoked in-process
rather than over the wire. ADK's A2A surface works; it is just the wrong fit here:

- `toA2a()` from `@google/adk/a2a` mounts the agent on an **Express HTTP
  server**. `express` is an optional peer dependency that this project does not
  install, and standing up an authenticated HTTP service is squarely the "API
  routes" this stage was asked not to build.
- `toA2a()` fails closed without an `authentication` UserBuilder, so a correct
  deployment also needs a token issuer and verifier — real work that buys
  nothing while both agents live in one process.
- The consumer side, `RemoteA2AAgent`, resolves a published agent card over
  HTTP. A one-shot CLI pipeline has no stable base URL to publish one at.

Moving it out is a transport change, not a redesign: replace the
`runChallengerAgent` call in the orchestrator with a `RemoteA2AAgent` pointed at
the challenger's card URL, serve `createChallengerAgent()` with
`toA2a(agent, { agentCard, authentication })` behind a long-running process, and
keep the envelope logging exactly as it is.

## Scripts

| Script                  | Purpose                              |
| ----------------------- | ------------------------------------ |
| `npm run dev`           | Dev server                           |
| `npm run build`         | Production build                     |
| `npm run typecheck`     | `tsc --noEmit`                       |
| `npm run lint`          | ESLint                               |
| `npm run db:generate`   | Generate SQL migrations from schema  |
| `npm run db:migrate`    | Apply migrations                     |
| `npm run db:push`       | Push schema straight to the database |
| `npm run db:studio`     | Drizzle Studio                       |
| `npm run db:guards`     | Apply `src/db/sql/guards.sql`        |
| `npm run db:sync`       | `db:push` then `db:guards`           |
| `npm run db:seed`       | Seed demo users, rules, transactions |
| `npm run check:rules`   | Validate rules, engine and backtest  |
| `npm run demo:circular` | Regenerate the demo circular PDF     |
| `npm run agents:run`    | Run the pipeline over a PDF          |
| `npm run auth:generate` | Generate Better Auth tables          |

Use `npm run db:sync` rather than a bare `db:push`: `push` only knows about the
Drizzle schema and will drop the triggers and CHECK constraints that
`guards.sql` installs.

```bash
npm run agents:run -- samples/circulars/demo-aml-cash-threshold.pdf
```

## A note on `npm install` in this environment

The global `~/.npmrc` sets `allow-scripts`, which npm 11 rejects when it leaks
into a project-scoped install — this makes `npx create-next-app` and
`npx shadcn` fail with `EALLOWSCRIPTS`. Workaround: run the local binary with
the variable cleared, e.g.
`env -u npm_config_allow_scripts ./node_modules/.bin/shadcn add <component>`.
