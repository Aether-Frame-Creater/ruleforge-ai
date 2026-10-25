/**
 * The rule contract: what a RuleForge rule is allowed to contain.
 *
 * This is the guardrail between a language model and the rule engine. An agent
 * drafts json-logic; nothing runs until it passes {@link validateRule}. The
 * allowlist is deliberately small — every operator and every field a rule can
 * touch is enumerated here, so a drafted rule cannot reach data it was never
 * meant to see or use an operator whose behaviour we have not reasoned about.
 *
 * Notably absent, on purpose:
 * - `if`, `?:` — branching makes a rule's effect hard to review.
 * - `+`, `-`, `*`, `/`, `%` — arithmetic invites unit confusion in money.
 * - `cat`, `substr`, `merge`, `reduce`, `map`, `filter`, `all`, `some`, `none`.
 * - `method`, `var` with a fallback — both can reach beyond the named field.
 */
import { z } from "zod";

/** Operators a rule may use. Anything else is rejected. */
export const SAFE_OPERATORS = [
  "and",
  "or",
  "!",
  "==",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "in",
  "var",
] as const;

export type SafeOperator = (typeof SAFE_OPERATORS)[number];

/** Transaction fields a rule may read. Anything else is rejected. */
export const RULE_FIELDS = [
  "amount",
  "currency",
  "type",
  "channel",
  "branch",
  "country",
  "customer_id",
] as const;

export type RuleField = (typeof RULE_FIELDS)[number];

/** The comparison operators, split out because they share arity rules. */
export const COMPARISON_OPERATORS = [
  "==",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
] as const;

export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

export type RuleLiteral = string | number | boolean | null;

/** A reference to one transaction field. No fallback value is permitted. */
export type RuleVar = { var: RuleField | [RuleField] };

export type RuleLogic =
  | RuleLiteral
  | RuleVar
  | { and: RuleLogic[] }
  | { or: RuleLogic[] }
  | { "!": RuleLogic | [RuleLogic] }
  | { "==": [RuleLogic, RuleLogic] }
  | { "!=": [RuleLogic, RuleLogic] }
  | { ">": [RuleLogic, RuleLogic] }
  | { ">=": [RuleLogic, RuleLogic] }
  | { "<": [RuleLogic, RuleLogic] }
  | { "<=": [RuleLogic, RuleLogic] }
  | { in: [RuleLogic, RuleLiteral[] | RuleVar] };

export interface RuleValidationResult {
  ok: boolean;
  errors: string[];
}

const SAFE_OPERATOR_SET: ReadonlySet<string> = new Set(SAFE_OPERATORS);
const RULE_FIELD_SET: ReadonlySet<string> = new Set(RULE_FIELDS);
const COMPARISON_SET: ReadonlySet<string> = new Set(COMPARISON_OPERATORS);

function isLiteral(value: unknown): value is RuleLiteral {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "number" && !Number.isFinite(value)) {
    return `the non-finite number ${value}`;
  }
  return `a value of type ${typeof value}`;
}

/** Validates `{ var: ... }`. */
function checkVar(args: unknown, path: string, errors: string[]): void {
  let field: unknown;

  if (typeof args === "string") {
    field = args;
  } else if (Array.isArray(args)) {
    if (args.length !== 1) {
      errors.push(
        args.length > 1
          ? `${path}: "var" must not supply a fallback value; name exactly one field`
          : `${path}: "var" must name a field`,
      );
      return;
    }
    field = args[0];
  } else {
    errors.push(
      `${path}: "var" must name a field as a string, got ${describe(args)}`,
    );
    return;
  }

  if (typeof field !== "string") {
    errors.push(
      `${path}: "var" must name a field as a string, got ${describe(field)}`,
    );
    return;
  }

  if (!RULE_FIELD_SET.has(field)) {
    errors.push(
      `${path}: unknown transaction field "${field}"; allowed fields are ${RULE_FIELDS.join(", ")}`,
    );
  }
}

/** Validates `{ in: [needle, haystack] }`. */
function checkIn(args: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(args) || args.length !== 2) {
    errors.push(
      `${path}: "in" takes exactly two operands — a value and a list of values`,
    );
    return;
  }

  checkNode(args[0], `${path}[0]`, errors);

  const haystack = args[1];
  if (typeof haystack === "string") {
    // json-logic's `in` does substring matching on strings, which is a
    // surprising way for a rule to match far more than it looks like it does.
    errors.push(
      `${path}[1]: "in" needs a list of values, not a string (substring matching is not allowed)`,
    );
    return;
  }

  if (Array.isArray(haystack)) {
    haystack.forEach((item, i) => {
      if (!isLiteral(item)) {
        errors.push(
          `${path}[1][${i}]: an "in" list may only contain literal values, got ${describe(item)}`,
        );
      }
    });
    return;
  }

  // The only non-array form we allow is a field reference.
  checkNode(haystack, `${path}[1]`, errors);
}

/** Validates any node that may legitimately be a literal or a condition. */
function checkNode(node: unknown, path: string, errors: string[]): void {
  if (isLiteral(node)) return;

  if (Array.isArray(node)) {
    errors.push(
      `${path}: expected a condition object or a literal value, got an array`,
    );
    return;
  }

  if (typeof node !== "object") {
    errors.push(`${path}: unsupported value — ${describe(node)}`);
    return;
  }

  const keys = Object.keys(node);
  if (keys.length !== 1) {
    errors.push(
      keys.length === 0
        ? `${path}: a condition must name one operator, found an empty object`
        : `${path}: a condition must name exactly one operator, found ${keys.length} (${keys.join(", ")})`,
    );
    return;
  }

  const operator = keys[0];
  if (!SAFE_OPERATOR_SET.has(operator)) {
    errors.push(
      `${path}: operator "${operator}" is not allowed; allowed operators are ${SAFE_OPERATORS.join(", ")}`,
    );
    return;
  }

  const args = (node as Record<string, unknown>)[operator];
  const here = `${path}.${operator}`;

  if (operator === "var") {
    checkVar(args, here, errors);
    return;
  }

  if (operator === "in") {
    checkIn(args, here, errors);
    return;
  }

  if (operator === "and" || operator === "or") {
    if (!Array.isArray(args) || args.length === 0) {
      errors.push(
        `${here}: "${operator}" takes a non-empty array of conditions, got ${describe(args)}`,
      );
      return;
    }
    args.forEach((arg, i) => checkNode(arg, `${here}[${i}]`, errors));
    return;
  }

  if (operator === "!") {
    const inner = Array.isArray(args) ? args : [args];
    if (inner.length !== 1) {
      errors.push(`${here}: "!" takes exactly one condition`);
      return;
    }
    checkNode(inner[0], `${here}[0]`, errors);
    return;
  }

  if (COMPARISON_SET.has(operator)) {
    if (!Array.isArray(args) || args.length !== 2) {
      errors.push(
        `${here}: "${operator}" takes exactly two operands, got ${
          Array.isArray(args) ? `${args.length}` : describe(args)
        }`,
      );
      return;
    }
    args.forEach((arg, i) => checkNode(arg, `${here}[${i}]`, errors));
    return;
  }

  // Unreachable while SAFE_OPERATORS and the branches above agree.
  errors.push(`${path}: operator "${operator}" has no validation rule`);
}

/**
 * Validates a whole rule. The root must be a condition, not a bare literal or
 * a bare field: `true` as a rule would flag every transaction ever made, and
 * `{"var":"amount"}` flags every transaction with a non-zero amount.
 */
function checkRoot(rule: unknown, errors: string[]): void {
  if (isLiteral(rule)) {
    errors.push(
      `rule: a rule must be a condition, not the bare value ${JSON.stringify(rule)}`,
    );
    return;
  }

  if (!Array.isArray(rule) && typeof rule === "object" && rule !== null) {
    const keys = Object.keys(rule);
    if (keys.length === 1 && keys[0] === "var") {
      errors.push(
        `rule: a rule must be a condition, not a bare field reference`,
      );
      return;
    }
  }

  checkNode(rule, "rule", errors);
}

/**
 * Checks a drafted rule against the contract.
 *
 * Returns every problem found rather than stopping at the first, so an agent
 * (or a reviewer) can fix a rule in one pass.
 */
export function validateRule(json: unknown): RuleValidationResult {
  const errors: string[] = [];
  checkRoot(json, errors);
  return { ok: errors.length === 0, errors };
}

/**
 * The rule contract as a Zod schema, for validating agent output alongside
 * other Zod schemas.
 *
 * It delegates to {@link validateRule} instead of being built from nested
 * `z.union`s: a recursive union reports a failure against every branch it
 * tried, which buries the one message that matters.
 */
export const ruleLogicSchema: z.ZodType<RuleLogic, unknown> = z
  .unknown()
  .superRefine((value, ctx) => {
    for (const message of validateRule(value).errors) {
      ctx.addIssue({ code: "custom", message });
    }
  })
  .transform((value) => value as RuleLogic);

/** True when `json` satisfies the rule contract. */
export function isRuleLogic(json: unknown): json is RuleLogic {
  return validateRule(json).ok;
}

/**
 * Returns `json` typed as a rule, or throws listing everything wrong with it.
 * Used by the engine so an invalid rule can never be evaluated by accident.
 */
export function assertRule(json: unknown): RuleLogic {
  const { ok, errors } = validateRule(json);
  if (!ok) {
    throw new Error(
      `Invalid rule:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
  return json as RuleLogic;
}
