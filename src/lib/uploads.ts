/**
 * Upload limits, shared by the server action that enforces them and the form
 * that shows them.
 *
 * In their own module because a `"use server"` file may only export async
 * functions — exporting a constant from one fails at runtime, not at build.
 */

/** Uploads are capped well below what a circular ever needs. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

/** The first bytes of every PDF. Checked so the extension cannot lie. */
export const PDF_MAGIC = "%PDF-";
