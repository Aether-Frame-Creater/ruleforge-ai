"use server";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { runCircularPipeline } from "@/agents/orchestrator";
import { circulars, obligations } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, PDF_MAGIC } from "@/lib/uploads";

import { failure, parseInput, toActionError, writeAudit, type ActionResult } from "./shared";

const STORAGE_DIR = "storage/circulars";

const uploadSchema = z.object({
  file: z
    .instanceof(File, { message: "Choose a PDF to upload." })
    .refine((file) => file.size > 0, "That file is empty.")
    .refine(
      (file) => file.size <= MAX_UPLOAD_BYTES,
      `The file is larger than ${MAX_UPLOAD_MB} MB.`,
    )
    .refine(
      (file) =>
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf"),
      "Only PDF files are accepted.",
    ),
});

/**
 * Stores an uploaded circular and starts the pipeline in the background.
 *
 * The upload returns as soon as the file is on disk and the row exists; the
 * agents run after the response via `after()`, and the circular page polls
 * `agent_runs` to show progress. A pipeline failure leaves the circular where
 * it was and is recorded — it must not take the request down with it.
 */
export async function uploadCircularAction(
  formData: FormData,
): Promise<ActionResult<{ circularId: string }>> {
  try {
    const user = await requireRole(["officer"]);

    const parsed = parseInput(uploadSchema, { file: formData.get("file") });
    if (!parsed.ok) return parsed.result;

    const file = parsed.data.file;
    const bytes = Buffer.from(await file.arrayBuffer());

    // Trust the bytes, not the name or the browser-supplied content type.
    if (!bytes.subarray(0, PDF_MAGIC.length).toString("latin1").startsWith(PDF_MAGIC)) {
      return failure("That file is not a PDF.", {
        file: ["The file does not start with a PDF header."],
      });
    }

    await mkdir(STORAGE_DIR, { recursive: true });
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
    const storedPath = join(STORAGE_DIR, `${randomUUID()}-${safeName}`);
    await writeFile(storedPath, bytes);

    const [circular] = await db
      .insert(circulars)
      .values({
        // Placeholders; the intake agent replaces them from the document.
        title: file.name.replace(/\.pdf$/i, ""),
        regulator: "other",
        pdfUrl: storedPath,
        status: "uploaded",
        uploadedBy: user.id,
      })
      .returning({ id: circulars.id });

    await writeAudit({
      actor: `user:${user.email}`,
      action: "circular.uploaded",
      entityType: "circulars",
      entityId: circular.id,
      details: {
        file_name: file.name,
        bytes: bytes.length,
        stored_path: storedPath,
      },
    });

    after(async () => {
      try {
        await runCircularPipeline(circular.id);
      } catch (error) {
        console.error("[pipeline]", circular.id, error);
        await writeAudit({
          actor: "agent:orchestrator",
          action: "pipeline.failed",
          entityType: "circulars",
          entityId: circular.id,
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });

    revalidatePath("/circulars");
    return { ok: true, data: { circularId: circular.id } };
  } catch (error) {
    return toActionError(error);
  }
}

const obligationDecisionSchema = z.object({
  obligationId: z.string().uuid(),
  decision: z.enum(["confirmed", "rejected"]),
});

/** Confirms or rejects one extracted obligation. */
export async function decideObligationAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const user = await requireRole(["officer"]);
    const parsed = parseInput(obligationDecisionSchema, input);
    if (!parsed.ok) return parsed.result;

    const [updated] = await db
      .update(obligations)
      .set({ status: parsed.data.decision, reviewedBy: user.id })
      .where(eq(obligations.id, parsed.data.obligationId))
      .returning({ id: obligations.id, circularId: obligations.circularId });

    if (!updated) return failure("That obligation no longer exists.");

    await writeAudit({
      actor: `user:${user.email}`,
      action: `obligation.${parsed.data.decision}`,
      entityType: "obligations",
      entityId: updated.id,
      details: { circular_id: updated.circularId },
    });

    revalidatePath(`/circulars/${updated.circularId}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

const editObligationSchema = z.object({
  obligationId: z.string().uuid(),
  summary: z
    .string()
    .trim()
    .min(10, "A summary needs at least 10 characters.")
    .max(500, "Keep the summary under 500 characters."),
});

/** Edits an obligation's summary, recording what it was before. */
export async function editObligationAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const user = await requireRole(["officer"]);
    const parsed = parseInput(editObligationSchema, input);
    if (!parsed.ok) return parsed.result;

    const [before] = await db
      .select({ summary: obligations.summary, circularId: obligations.circularId })
      .from(obligations)
      .where(eq(obligations.id, parsed.data.obligationId))
      .limit(1);

    if (!before) return failure("That obligation no longer exists.");

    await db
      .update(obligations)
      .set({
        summary: parsed.data.summary,
        status: "edited",
        reviewedBy: user.id,
      })
      .where(eq(obligations.id, parsed.data.obligationId));

    await writeAudit({
      actor: `user:${user.email}`,
      action: "obligation.edited",
      entityType: "obligations",
      entityId: parsed.data.obligationId,
      details: {
        circular_id: before.circularId,
        previous_summary: before.summary,
        new_summary: parsed.data.summary,
      },
    });

    revalidatePath(`/circulars/${before.circularId}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
