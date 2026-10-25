/**
 * Runs the circular pipeline over a PDF from the command line.
 *
 *   npm run agents:run -- samples/circulars/demo-aml-cash-threshold.pdf
 *
 * Creates a `circulars` row attributed to officer@ruleforge.demo, copies the PDF
 * into storage/circulars/, runs the pipeline, and prints the full case file.
 * Nothing it produces is approved: every rule version comes out as a draft.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { LogLevel, setLogLevel } from "@google/adk";
import { eq } from "drizzle-orm";

import { llmMode, CACHE_LOCATION } from "@/agents/llm-cache";
import { runCircularPipeline } from "@/agents/orchestrator";
import { audit } from "@/agents/runtime";
import { circularKey, storage } from "@/lib/storage";
import { GEMINI_MODEL, GEMINI_MODEL_FALLBACK, GEMINI_MODEL_LITE } from "@/lib/ai/gemini";
import { circulars, user } from "@/db/schema";
import { db } from "@/lib/db";

const UPLOADER_EMAIL = "officer@ruleforge.demo";

function rule(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

function section(title: string) {
  console.log(`\n--- ${title} ${"-".repeat(Math.max(0, 66 - title.length))}`);
}

const MODE_NOTES: Record<ReturnType<typeof llmMode>, string> = {
  cache: `  (read-through: uses ${CACHE_LOCATION} when it can, else calls and saves)`,
  live: `  (always calls the API, then saves to ${CACHE_LOCATION})`,
  record: `  (always calls the API, saving responses to ${CACHE_LOCATION})`,
  replay: "  (serves saved responses only; no API calls)",
};

function money(value: number): string {
  return value.toLocaleString("en-US");
}

async function main() {
  // ADK logs every request at INFO; the pipeline prints its own progress.
  setLogLevel(LogLevel.WARN);

  // No silent default: running the pipeline costs model calls and writes a
  // circular, so it must be obvious which document is being processed.
  const mode = llmMode();
  const source = process.argv[2];
  if (!source) {
    console.error("usage: npm run agents:run -- <path-to-circular.pdf>\n");
    console.error("example:");
    console.error(
      "  npm run agents:run -- samples/circulars/demo-aml-cash-threshold.pdf\n",
    );
    console.error("Generate the demo circular with: npm run demo:circular");
    process.exit(2);
  }

  if (!source.toLowerCase().endsWith(".pdf")) {
    console.error(`${source} is not a .pdf file.`);
    process.exit(2);
  }

  if (!existsSync(source)) {
    console.error(`${source} does not exist.`);
    process.exit(2);
  }

  const startedAt = Date.now();

  const [uploader] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.email, UPLOADER_EMAIL))
    .limit(1);

  if (!uploader) {
    throw new Error(
      `${UPLOADER_EMAIL} does not exist. Run \`npm run db:seed\` first.`,
    );
  }

  // Store the PDF under a generated key so two uploads of the same file do not
  // collide, and so the stored copy is immutable evidence of what was read.
  const stored = await storage().put(
    circularKey(basename(source)),
    await readFile(source),
    "application/pdf",
  );

  const [circular] = await db
    .insert(circulars)
    .values({
      // Placeholders; the intake agent replaces them from the document itself.
      title: basename(source),
      regulator: "other",
      pdfUrl: stored.key,
      status: "uploaded",
      uploadedBy: uploader.id,
    })
    .returning({ id: circulars.id });

  await audit({
    actor: `user:${uploader.email}`,
    action: "circular.uploaded",
    entityType: "circulars",
    entityId: circular.id,
    details: { source, storage_driver: storage().driver, storage_key: stored.key },
  });

  rule("RuleForge AI — circular pipeline");
  console.log(`  source:      ${source}`);
  console.log(`  stored as:   ${stored.key} (${storage().driver})`);
  console.log(`  circular id: ${circular.id}`);
  console.log(`  uploaded by: ${uploader.email}`);
  console.log(`  LLM_MODE:    ${mode}${MODE_NOTES[mode]}`);
  console.log(`  main model:  ${GEMINI_MODEL}`);
  console.log(`  lite model:  ${GEMINI_MODEL_LITE}`);
  console.log(
    `  fallback:    ${GEMINI_MODEL_FALLBACK ?? "(none — a quota failure stops the run)"}`,
  );

  section("pipeline");
  const result = await runCircularPipeline(circular.id, {
    onProgress: (message) => console.log(`  ${message}`),
  });

  const { caseFile } = result;

  /* -- applicability ------------------------------------------------------ */

  section("applicability");
  if (caseFile.applicability) {
    console.log(`  applicable:  ${caseFile.applicability.applicable}`);
    console.log(`  confidence:  ${caseFile.applicability.confidence}`);
    console.log(`  reason:      ${caseFile.applicability.reason}`);
  } else {
    console.log("  (not reached)");
  }

  /* -- intake ------------------------------------------------------------- */

  if (caseFile.intake) {
    section("circular as read");
    console.log(`  title:       ${caseFile.intake.title}`);
    console.log(`  regulator:   ${caseFile.intake.regulator}`);
    console.log(`  number:      ${caseFile.intake.circularNumber ?? "(none)"}`);
    console.log(`  issued:      ${caseFile.intake.issuedDate ?? "(none)"}`);
    console.log(`  paragraphs:  ${caseFile.intake.paragraphs.length}`);
    console.log(
      `  chunks:      ${caseFile.chunks.length} stored, ${caseFile.chunks.filter((c) => c.embedded).length} embedded`,
    );
    if (caseFile.intake.injectionAttemptNoted) {
      console.log(
        `  ! injection attempt noted: ${caseFile.intake.injectionAttemptNoted}`,
      );
    }
  }

  /* -- obligations -------------------------------------------------------- */

  section("obligations");
  if (caseFile.obligations.length === 0) {
    console.log("  (none verified)");
  }
  for (const obligation of caseFile.obligations) {
    console.log(`  [${obligation.paragraphRef}] ${obligation.summary}`);
    console.log(`      type:     ${obligation.obligationType}`);
    console.log(`      deadline: ${obligation.deadline ?? "(none stated)"}`);
    console.log(`      chunk:    ${obligation.chunkId ?? "(unlinked)"}`);
    console.log(`      quote:    "${obligation.quote}"`);
  }
  if (caseFile.rejectedObligations.length > 0) {
    console.log(
      `\n  dropped by the quote check: ${caseFile.rejectedObligations.length}`,
    );
    for (const dropped of caseFile.rejectedObligations) {
      console.log(`      - ${dropped.reason}`);
    }
  }

  /* -- mapping ------------------------------------------------------------ */

  section("mapping");
  for (const mapping of caseFile.mappings) {
    console.log(
      `  [${mapping.paragraphRef}] ${mapping.decision}${mapping.ruleCode ? ` -> ${mapping.ruleCode}` : ""}`,
    );
    console.log(`      ${mapping.rationale}`);
  }

  /* -- drafts ------------------------------------------------------------- */

  section("draft rule versions");
  if (caseFile.drafts.length === 0) {
    console.log("  (none)");
  }
  for (const draft of caseFile.drafts) {
    console.log(`\n  ${draft.ruleCode} v${draft.version}  [status: draft]`);
    console.log(`      version id:  ${draft.ruleVersionId}`);
    console.log(`      obligation:  ${draft.obligationId}`);
    console.log(`      authored in: ${draft.attempts} attempt(s)`);
    console.log(`      behaviour:   ${draft.explanation}`);
    console.log(`      json_logic:  ${JSON.stringify(draft.jsonLogic)}`);
    console.log("      diff vs the version in force:");
    for (const line of draft.diff) console.log(`        - ${line}`);

    if (draft.backtest) {
      const bt = draft.backtest;
      console.log("      backtest:");
      console.log(`        transactions:        ${money(bt.total_txns)}`);
      console.log(`        alerts before:       ${money(bt.old_alerts)}`);
      console.log(`        alerts after:        ${money(bt.new_alerts)}`);
      console.log(`        added / removed:     +${bt.alerts_added} / -${bt.alerts_removed}`);
      console.log(`        customers affected:  ${money(bt.customers_affected)}`);
      console.log(`        run id:              ${bt.backtest_run_id}`);
    }

    if (draft.impact) {
      console.log(`      impact (risk: ${draft.impact.risk_level}):`);
      console.log(`        ${draft.impact.summary}`);
      for (const driver of draft.impact.drivers) {
        console.log(`        - ${driver}`);
      }
    }

    if (draft.challenger) {
      console.log(
        `      challenger: ${draft.challenger.verdict} (severity ${draft.challenger.severity})`,
      );
      for (const reason of draft.challenger.reasons) {
        console.log(`        - ${reason}`);
      }
    }

    if (draft.needsHumanAttention) {
      console.log(`      ** FLAGGED FOR HUMAN ATTENTION: ${draft.attentionReason}`);
    }
  }

  /* -- envelopes and cost -------------------------------------------------- */

  section("A2A envelopes");
  console.log(`  ${caseFile.envelopes.length} exchanged (all persisted in agent_runs)`);
  for (const env of caseFile.envelopes) {
    console.log(`    ${env.timestamp}  ${env.from} -> ${env.to}  [${env.type}]`);
  }

  /* -- timing ------------------------------------------------------------- */

  section("timing per call");
  console.log(
    "  agent                 kind   seconds  retries  thinking  tokens  conc  src     model",
  );
  for (const call of result.timings) {
    const source = call.fromCache ? "cache" : call.kind === "tool" ? "-" : "api";
    const columns = [
      call.agent.padEnd(20),
      call.kind.padEnd(5),
      (call.ms / 1000).toFixed(1).padStart(7),
      String(call.retries).padStart(7),
      String(call.thoughtTokens).padStart(8),
      String(call.totalTokens).padStart(6),
      (call.concurrent ? "yes" : "no").padEnd(4),
      source.padEnd(6),
      call.model ?? "-",
    ];
    console.log(`  ${columns.join("  ")}`);
  }
  const summed = result.timings.reduce((total, call) => total + call.ms, 0);
  console.log(
    `  ${"".padEnd(20)}  ${"total".padEnd(5)}  ${(summed / 1000).toFixed(1).padStart(7)}` +
      "   (sum of calls; concurrent ones overlap in wall time)",
  );

  section("usage");
  console.log(`  mode:             ${mode}`);
  console.log(`  agent calls:      ${result.stats.llmCalls}`);
  console.log(`  API calls:        ${result.stats.apiCalls}`);
  console.log(`  replayed:         ${result.stats.replayedCalls}`);
  console.log(`  fallback used:    ${result.stats.fallbackCalls}`);
  console.log(`  prompt tokens:    ${money(result.stats.promptTokens)}`);
  console.log(`  candidate tokens: ${money(result.stats.candidateTokens)}`);
  console.log(`  thinking tokens:  ${money(result.stats.thoughtTokens)}`);
  console.log(`  total tokens:     ${money(result.stats.totalTokens)}`);
  console.log(
    `  retries:          ${result.stats.retries}` +
      ` (rate-limited ${result.stats.retryCounts.rateLimited},` +
      ` unavailable ${result.stats.retryCounts.unavailable})`,
  );
  console.log(
    `  pipeline time:    ${(result.stats.elapsedMs / 1000).toFixed(1)}s`,
  );
  console.log(`  wall clock:       ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  rule(`OUTCOME: ${result.outcome}`);
  console.log(`  ${result.reason}`);
  console.log(
    "\n  No rule version was approved, shadowed or activated by any agent.",
  );
  console.log("  Every draft above is waiting on a human maker-checker decision.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\npipeline run failed:");
    console.error(error);
    process.exit(1);
  });
