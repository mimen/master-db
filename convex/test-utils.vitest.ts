// Named `.vitest.ts` (not `.ts`) so the Convex bundler skips it. Convex's
// bundler walks every `.ts` file under `convex/` and rejects `node:*`
// imports at runtime; the double-dot extension matches its skip rule
// (same convention as `*.test.ts`, `*.config.ts`).
import * as path from "node:path";
import * as url from "node:url";

const CONVEX_DIR = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
);

/**
 * Normalize `import.meta.glob` output for `convex-test`.
 *
 * `convexTest(schema, modules)` requires module keys to be paths relative to
 * the convex/ root, prefixed with "../../" (the path convex-test internally
 * uses to find its module-root anchor). Vite's `import.meta.glob` produces
 * keys relative to the calling file, which means a test file co-located with
 * its source emits `./foo.ts` while a test elsewhere emits `../../foo.ts` —
 * mixing the two breaks convex-test's prefix detection.
 *
 * Pass the raw glob result and the caller's `import.meta.url` and this
 * function returns an object with canonical keys.
 *
 * Usage in a Convex test:
 *
 *   const t = convexTest(schema, normalizeModules(
 *     import.meta.glob("../../**\/*.{ts,js}"),
 *     import.meta.url,
 *   ));
 */
export function normalizeModules(
  rawModules: Record<string, () => Promise<unknown>>,
  callerUrl: string,
): Record<string, () => Promise<unknown>> {
  const callerDir = path.dirname(url.fileURLToPath(callerUrl));
  return Object.fromEntries(
    Object.entries(rawModules).map(([key, loader]) => {
      const abs = path.resolve(callerDir, key);
      const rel =
        "../../" + path.relative(CONVEX_DIR, abs).replace(/\\/g, "/");
      return [rel, loader];
    }),
  );
}
