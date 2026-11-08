import type { MutationCtx } from "../_generated/server";

// An explicit module map instead of import.meta.glob, so comma tests run
// under both Vitest and `bun test`. convex-test finds its root from the
// "_generated" key, so every key keeps the "../../" prefix.
export const commaModules: Record<string, () => Promise<unknown>> = {
  "../../_generated/api.js": () => import("../_generated/api.js"),
  "../../_generated/server.js": () => import("../_generated/server.js"),
  "../../comma/accounts.ts": () => import("./accounts"),
  "../../comma/migrations.ts": () => import("./migrations"),
  "../../comma/outbox.ts": () => import("./outbox"),
  "../../comma/drafts.ts": () => import("./drafts"),
  "../../comma/ingest.ts": () => import("./ingest"),
  "../../comma/history.ts": () => import("./history"),
  "../../comma/conversationInfo.ts": () => import("./conversationInfo"),
  "../../comma/groupPhotos.ts": () => import("./groupPhotos"),
  "../../comma/internal.ts": () => import("./internal"),
  "../../comma/queries.ts": () => import("./queries"),
  "../../comma/today.ts": () => import("./today"),
  "../../comma/personSummaries.ts": () => import("./personSummaries"),
};

/** Gives `address` a named person in the identity graph, the way Comma resolves names. */
export async function namePerson(ctx: Pick<MutationCtx, "db">, address: string, display_name: string) {
  const person_id = await ctx.db.insert("people", {
    display_name, normalized_phones: [address], normalized_emails: [], identity_count: 1, message_count: 0,
    is_self: false, auto_clustered: false, created_at: "x", updated_at: "x",
  });
  await ctx.db.insert("identities", { person_id, kind: "phone", value: address, normalized: address, source: "manual",
    is_self: false, message_count: 0, chat_count: 0, created_at: "x", updated_at: "x" });
  return person_id;
}
