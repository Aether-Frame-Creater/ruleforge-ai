/**
 * The rule engine: evaluate a rule, explain it in English, diff two versions.
 *
 * Every entry point validates its input against the rule contract first, so an
 * unsafe or malformed rule cannot be evaluated, shown to a reviewer, or
 * compared — `validateRule` is the only gate, and it is never optional.
 */
import jsonLogic from "json-logic-js";

import {
  assertRule,
  COMPARISON_OPERATORS,
  RULE_FIELDS,
  type ComparisonOperator,
  type RuleField,
  type RuleLiteral,
  type RuleLogic,
} from "./schema";

/* -------------------------------------------------------------------------- */
/* Transaction data                                                           */
/* -------------------------------------------------------------------------- */

/** The data a rule sees. Exactly the fields the contract allows. */
export type RuleData = {
  amount: number;
  currency: string;
  type: string;
  channel: string;
  branch: string | null;
  country: string;
  customer_id: string;
};

/**
 * A transaction as the database hands it back. `amount` is `numeric`, which
 * the driver returns as a string to avoid float rounding, so it has to be
 * converted before a rule compares it to a number.
 */
export interface TransactionLike {
  amount: string | number;
  currency: string;
  type: string;
  channel: string;
  branch?: string | null;
  country: string;
  customerId?: string;
  customer_id?: string;
}

/** Normalises a transaction row into the shape a rule is allowed to read. */
export function toRuleData(txn: TransactionLike): RuleData {
  return {
    amount: typeof txn.amount === "number" ? txn.amount : Number(txn.amount),
    currency: txn.currency,
    type: txn.type,
    channel: txn.channel,
    branch: txn.branch ?? null,
    country: txn.country,
    customer_id: txn.customer_id ?? txn.customerId ?? "",
  };
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Validates a rule once and returns a function that evaluates it.
 *
 * Use this over {@link evaluateRule} in a loop: the backtester runs one rule
 * against tens of thousands of transactions and should not re-validate it
 * every time.
 */
export function compileRule(logic: unknown): (txn: TransactionLike) => boolean {
  const rule = assertRule(logic);
  return (txn) => applyRule(rule, toRuleData(txn));
}

/** A compiled rule that never fires — the baseline when no rule was in force. */
export const NEVER_FIRES = (): boolean => false;

function applyRule(rule: RuleLogic, data: RuleData): boolean {
  // `and`/`or` return the operand value rather than a coerced boolean, so the
  // result is run through json-logic's own truthiness rules.
  return jsonLogic.truthy(jsonLogic.apply(rule as never, data));
}

/** Evaluates a rule against one transaction. Throws if the rule is invalid. */
export function evaluateRule(logic: unknown, txn: TransactionLike): boolean {
  return applyRule(assertRule(logic), toRuleData(txn));
}

/* -------------------------------------------------------------------------- */
/* Explanation                                                                */
/* -------------------------------------------------------------------------- */

const FIELD_LABELS: Record<RuleField, string> = {
  amount: "amount",
  currency: "currency",
  type: "type",
  channel: "channel",
  branch: "branch",
  country: "country",
  customer_id: "customer ID",
};

const OPERATOR_WORDS: Record<ComparisonOperator, string> = {
  "==": "is",
  "!=": "is not",
  ">": ">",
  ">=": "≥",
  "<": "<",
  "<=": "≤",
};

/** The operator you get by swapping the operands around. */
const FLIPPED: Record<ComparisonOperator, ComparisonOperator> = {
  "==": "==",
  "!=": "!=",
  ">": "<",
  ">=": "<=",
  "<": ">",
  "<=": ">=",
};

const COMPARISON_SET: ReadonlySet<string> = new Set(COMPARISON_OPERATORS);
const RULE_FIELD_SET: ReadonlySet<string> = new Set(RULE_FIELDS);

function operatorOf(node: unknown): string | null {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return null;
  }
  const keys = Object.keys(node);
  return keys.length === 1 ? keys[0] : null;
}

function argsOf(node: unknown, operator: string): unknown {
  return (node as Record<string, unknown>)[operator];
}

/** The field a `{ var: ... }` node names, or null if the node is not a var. */
function varField(node: unknown): RuleField | null {
  if (operatorOf(node) !== "var") return null;
  const args = argsOf(node, "var");
  const field = typeof args === "string" ? args : (args as unknown[])?.[0];
  return typeof field === "string" && RULE_FIELD_SET.has(field)
    ? (field as RuleField)
    : null;
}

const AMOUNT_FORMAT = new Intl.NumberFormat("en-US");

function formatValue(value: unknown): string {
  if (typeof value === "number") return AMOUNT_FORMAT.format(value);
  if (value === null) return "empty";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  const field = varField(value);
  return field ? FIELD_LABELS[field] : JSON.stringify(value);
}

function describeComparison(
  operator: ComparisonOperator,
  args: readonly unknown[],
): string {
  let [left, right] = args;
  let op = operator;

  // Read naturally: `{"<": [1000000, {var: "amount"}]}` is "amount > 1,000,000".
  if (varField(left) === null && varField(right) !== null) {
    [left, right] = [right, left];
    op = FLIPPED[operator];
  }

  return `${formatValue(left)} ${OPERATOR_WORDS[op]} ${formatValue(right)}`;
}

function describeNode(node: RuleLogic, depth: number): string {
  const operator = operatorOf(node);

  if (operator === null) return formatValue(node);
  const args = argsOf(node, operator);

  if (operator === "var") return formatValue(node);

  if (operator === "and" || operator === "or") {
    const joiner = operator === "and" ? " AND " : " OR ";
    const parts = (args as RuleLogic[]).map((arg) =>
      describeNode(arg, depth + 1),
    );
    const joined = parts.join(joiner);
    // Only bracket a nested group; the outermost one reads better without.
    return depth > 0 && parts.length > 1 ? `(${joined})` : joined;
  }

  if (operator === "!") {
    const inner = Array.isArray(args) ? args[0] : args;
    return `NOT ${describeNode(inner as RuleLogic, depth + 1)}`;
  }

  if (operator === "in") {
    const [needle, haystack] = args as [RuleLogic, unknown];
    const values = Array.isArray(haystack)
      ? haystack.map((v) => formatValue(v)).join(", ")
      : formatValue(haystack);
    return `${formatValue(needle)} is one of ${values}`;
  }

  if (COMPARISON_SET.has(operator)) {
    return describeComparison(
      operator as ComparisonOperator,
      args as unknown[],
    );
  }

  return JSON.stringify(node);
}

/**
 * Renders a rule as one plain-English sentence, for reviewers who will never
 * read json-logic:
 *
 *   "Flag when type is cash_deposit AND amount ≥ 1,000,000"
 */
export function explainRule(logic: unknown): string {
  return `Flag when ${describeNode(assertRule(logic), 0)}`;
}

/* -------------------------------------------------------------------------- */
/* Diffing                                                                    */
/* -------------------------------------------------------------------------- */

export type RuleDiffKind =
  | "threshold-changed"
  | "value-changed"
  | "operator-changed"
  | "condition-added"
  | "condition-removed"
  | "structure-changed";

export interface RuleDiff {
  kind: RuleDiffKind;
  /** The field involved, where the change is about one field. */
  field?: RuleField;
  from?: string;
  to?: string;
  /** Reviewer-facing description of this one change. */
  message: string;
}

interface Condition {
  field: RuleField;
  operator: ComparisonOperator | "in";
  value: RuleLiteral | RuleLiteral[];
  text: string;
}

/** Walks a rule and pulls out every leaf condition that names a field. */
function collectConditions(node: RuleLogic, into: Condition[]): void {
  const operator = operatorOf(node);
  if (operator === null || operator === "var") return;
  const args = argsOf(node, operator);

  if (operator === "and" || operator === "or") {
    for (const arg of args as RuleLogic[]) collectConditions(arg, into);
    return;
  }

  if (operator === "!") {
    const inner = Array.isArray(args) ? args[0] : args;
    collectConditions(inner as RuleLogic, into);
    return;
  }

  if (operator === "in") {
    const [needle, haystack] = args as [RuleLogic, unknown];
    const field = varField(needle);
    if (field && Array.isArray(haystack)) {
      into.push({
        field,
        operator: "in",
        value: haystack as RuleLiteral[],
        text: describeNode(node, 1),
      });
    }
    return;
  }

  if (COMPARISON_SET.has(operator)) {
    const [left, right] = args as [unknown, unknown];
    const leftField = varField(left);
    const rightField = varField(right);

    if (leftField && !rightField) {
      into.push({
        field: leftField,
        operator: operator as ComparisonOperator,
        value: right as RuleLiteral,
        text: describeNode(node, 1),
      });
    } else if (rightField && !leftField) {
      into.push({
        field: rightField,
        operator: FLIPPED[operator as ComparisonOperator],
        value: left as RuleLiteral,
        text: describeNode(node, 1),
      });
    }
  }
}

function formatConditionValue(value: Condition["value"]): string {
  return Array.isArray(value)
    ? value.map((v) => formatValue(v)).join(", ")
    : formatValue(value);
}

function sameValue(a: Condition["value"], b: Condition["value"]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Lists what changed between two rule versions, in reviewer-facing terms:
 * a moved threshold, a swapped operator, a condition added or dropped.
 *
 * Conditions are matched by field, which is what a reviewer cares about
 * ("the amount threshold moved"), not by position in the json-logic tree.
 */
export function diffRules(oldLogic: unknown, newLogic: unknown): RuleDiff[] {
  const before = assertRule(oldLogic);
  const after = assertRule(newLogic);

  const diffs: RuleDiff[] = [];

  const oldCombinator = operatorOf(before);
  const newCombinator = operatorOf(after);
  if (
    (oldCombinator === "and" || oldCombinator === "or") &&
    (newCombinator === "and" || newCombinator === "or") &&
    oldCombinator !== newCombinator
  ) {
    diffs.push({
      kind: "structure-changed",
      from: oldCombinator.toUpperCase(),
      to: newCombinator.toUpperCase(),
      message: `conditions are now combined with ${newCombinator.toUpperCase()} instead of ${oldCombinator.toUpperCase()}`,
    });
  }

  const oldConditions: Condition[] = [];
  const newConditions: Condition[] = [];
  collectConditions(before, oldConditions);
  collectConditions(after, newConditions);

  const fields = new Set<RuleField>([
    ...oldConditions.map((c) => c.field),
    ...newConditions.map((c) => c.field),
  ]);

  for (const field of fields) {
    const olds = oldConditions.filter((c) => c.field === field);
    const news = newConditions.filter((c) => c.field === field);

    // The common case: one condition per field on each side.
    if (olds.length === 1 && news.length === 1) {
      const [o] = olds;
      const [n] = news;

      if (o.operator !== n.operator && sameValue(o.value, n.value)) {
        diffs.push({
          kind: "operator-changed",
          field,
          from: o.text,
          to: n.text,
          message: `${FIELD_LABELS[field]} test changed from "${o.text}" to "${n.text}"`,
        });
      } else if (!sameValue(o.value, n.value)) {
        const from = formatConditionValue(o.value);
        const to = formatConditionValue(n.value);
        const numeric =
          typeof o.value === "number" && typeof n.value === "number";
        diffs.push({
          kind: numeric ? "threshold-changed" : "value-changed",
          field,
          from,
          to,
          message:
            o.operator === n.operator
              ? `${FIELD_LABELS[field]} ${OPERATOR_WORDS[o.operator as ComparisonOperator] ?? o.operator} changed from ${from} to ${to}`
              : `${FIELD_LABELS[field]} test changed from "${o.text}" to "${n.text}"`,
        });
      }
      continue;
    }

    // Otherwise fall back to set differences on the rendered text.
    const oldTexts = new Set(olds.map((c) => c.text));
    const newTexts = new Set(news.map((c) => c.text));

    for (const c of news) {
      if (!oldTexts.has(c.text)) {
        diffs.push({
          kind: "condition-added",
          field,
          to: c.text,
          message: `added condition: ${c.text}`,
        });
      }
    }
    for (const c of olds) {
      if (!newTexts.has(c.text)) {
        diffs.push({
          kind: "condition-removed",
          field,
          from: c.text,
          message: `removed condition: ${c.text}`,
        });
      }
    }
  }

  return diffs;
}
