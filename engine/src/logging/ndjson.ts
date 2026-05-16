import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// Sanitize entity_ref into a filename-safe slug. Letters, digits, `.`, `_`,
// and `-` are preserved; everything else (including `:`) becomes `_`.
function sanitize(entity_ref: string): string {
  return entity_ref.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export interface NdjsonAppender {
  append: (entity_ref: string, event: unknown) => Promise<void>;
}

export function createNdjsonAppender(opts: {
  baseDir: string;
}): NdjsonAppender {
  let initPromise: Promise<void> | null = null;
  const ensureInitialized = (): Promise<void> =>
    (initPromise ??= mkdir(opts.baseDir, { recursive: true }).then(() => {}));

  return {
    async append(entity_ref, event) {
      await ensureInitialized();
      const path = join(opts.baseDir, `${sanitize(entity_ref)}.ndjson`);
      await appendFile(path, JSON.stringify(event) + "\n", "utf8");
    },
  };
}
