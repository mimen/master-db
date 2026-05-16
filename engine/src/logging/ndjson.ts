import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

function sanitize(entity_ref: string): string {
  return entity_ref.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export interface NdjsonAppender {
  append: (entity_ref: string, event: unknown) => Promise<void>;
}

export function createNdjsonAppender(opts: {
  baseDir: string;
}): NdjsonAppender {
  let initialized = false;
  return {
    async append(entity_ref, event) {
      if (!initialized) {
        await mkdir(opts.baseDir, { recursive: true });
        initialized = true;
      }
      const path = join(opts.baseDir, `${sanitize(entity_ref)}.ndjson`);
      await appendFile(path, JSON.stringify(event) + "\n", "utf8");
    },
  };
}
