// An explicit module map instead of import.meta.glob, so comma tests run
// under both Vitest and `bun test`. convex-test finds its root from the
// "_generated" key, so every key keeps the "../../" prefix.
export const commaModules: Record<string, () => Promise<unknown>> = {
  "../../_generated/api.js": () => import("../_generated/api.js"),
  "../../_generated/server.js": () => import("../_generated/server.js"),
  "../../comma/outbox.ts": () => import("./outbox"),
  "../../comma/drafts.ts": () => import("./drafts"),
  "../../comma/ingest.ts": () => import("./ingest"),
  "../../comma/queries.ts": () => import("./queries"),
};
