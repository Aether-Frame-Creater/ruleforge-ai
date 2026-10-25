/**
 * Where uploaded circular PDFs live.
 *
 * Local development writes to `storage/circulars/`. Vercel's filesystem is
 * read-only at runtime, so a deployment uses Vercel Blob instead. Both are
 * reached through the same three operations, and `circulars.pdf_url` holds a
 * *key* that only this module knows how to resolve.
 *
 * The driver is chosen by `STORAGE_DRIVER`, defaulting to `local` so nothing
 * changes for a developer who has not set it.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { env } from "@/lib/env";

export type StorageDriver = "local" | "blob";

export interface StoredObject {
  /** What goes in `circulars.pdf_url`. Opaque outside this module. */
  key: string;
  size: number;
  /** A URL the file can be fetched from, when the driver has one. */
  url?: string;
}

export interface Storage {
  readonly driver: StorageDriver;
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** Rejects keys that could escape the prefix they are supposed to live under. */
function assertSafeKey(key: string): void {
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("..") ||
    key.includes("\\") ||
    /[\u0000-\u001f]/.test(key)
  ) {
    throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Local driver                                                               */
/* -------------------------------------------------------------------------- */

function localStorage(): Storage {
  const root = "storage";

  return {
    driver: "local",

    // The content type is not recorded: the local driver stores plain files
    // and the extension already carries it.
    async put(key, body) {
      assertSafeKey(key);
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname, join } = await import("node:path");
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      return { key, size: body.length };
    },

    async get(key) {
      assertSafeKey(key);
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      return readFile(join(root, key));
    },

    async delete(key) {
      assertSafeKey(key);
      const { unlink } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await unlink(join(root, key)).catch(() => {
        // Deleting something already gone is the desired end state.
      });
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Vercel Blob driver                                                         */
/* -------------------------------------------------------------------------- */

function blobStorage(): Storage {
  return {
    driver: "blob",

    async put(key, body, contentType) {
      assertSafeKey(key);
      const { put } = await import("@vercel/blob");
      const result = await put(key, body, {
        access: "public",
        contentType,
        // The key already carries a UUID, so Vercel must not add another
        // suffix — otherwise the key we store would not be the key that exists.
        addRandomSuffix: false,
        token: env.BLOB_READ_WRITE_TOKEN,
      });
      return { key: result.url, size: body.length, url: result.url };
    },

    async get(key) {
      // A blob key is its own public URL, so a fetch is the read path.
      const response = await fetch(key, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          `Could not read ${key} from Vercel Blob: ${response.status} ${response.statusText}`,
        );
      }
      return Buffer.from(await response.arrayBuffer());
    },

    async delete(key) {
      const { del } = await import("@vercel/blob");
      await del(key, { token: env.BLOB_READ_WRITE_TOKEN });
    },
  };
}

/* -------------------------------------------------------------------------- */

let cached: Storage | null = null;

/** The configured storage driver. */
export function storage(): Storage {
  if (cached) return cached;

  if (env.STORAGE_DRIVER === "blob") {
    if (!env.BLOB_READ_WRITE_TOKEN) {
      throw new Error(
        "STORAGE_DRIVER=blob needs BLOB_READ_WRITE_TOKEN. Create a Blob store in the Vercel dashboard and link it to the project.",
      );
    }
    cached = blobStorage();
  } else {
    cached = localStorage();
  }

  return cached;
}

/**
 * The key for a newly uploaded circular.
 *
 * A UUID prefix so two uploads of the same file never collide, and the
 * original name kept (sanitised) so a human can tell what it is.
 */
export function circularKey(fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  return `circulars/${randomUUID()}-${safe}`;
}
