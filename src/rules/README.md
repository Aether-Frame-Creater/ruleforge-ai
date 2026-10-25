# Rules

JSON rule definitions and the `json-logic-js` evaluation surface live here.

Planned contents:

- `schema.ts` — Zod schema for a RuleForge rule (metadata + a `json-logic` expression).
- `engine.ts` — thin wrapper over `jsonLogic.apply()` that evaluates a rule against a transaction.
- `fixtures/` — checked-in rule versions used by the backtester.

Nothing is implemented yet.
