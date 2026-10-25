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
  agents/       ADK agents (one placeholder so far)
  rules/        JSON rule definitions and evaluation (empty)
  db/           Drizzle schema, migrations, extensions.sql
```

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
| `npm run auth:generate` | Generate Better Auth tables          |

## A note on `npm install` in this environment

The global `~/.npmrc` sets `allow-scripts`, which npm 11 rejects when it leaks
into a project-scoped install — this makes `npx create-next-app` and
`npx shadcn` fail with `EALLOWSCRIPTS`. Workaround: run the local binary with
the variable cleared, e.g.
`env -u npm_config_allow_scripts ./node_modules/.bin/shadcn add <component>`.
