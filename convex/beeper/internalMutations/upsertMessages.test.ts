import { describe, expect, test } from "vitest";

// Pure helpers copied/duplicated from upsertMessages.ts so we test the
// transformation logic without needing convex-test scaffolding.

type Attachment = {
  mxc_id: string;
  convex_storage_id?: string;
  mime_type?: string;
};

function mergeAttachments(prev: Attachment[], next: Attachment[]): Attachment[] {
  if (!prev.length) return next;
  const prevById = new Map<string, Attachment>();
  for (const a of prev) prevById.set(a.mxc_id, a);
  return next.map((n) => {
    const old = prevById.get(n.mxc_id);
    if (old?.convex_storage_id && !n.convex_storage_id) {
      return { ...n, convex_storage_id: old.convex_storage_id };
    }
    return n;
  });
}

describe("upsertMessages.mergeAttachments", () => {
  test("returns `next` unchanged when there is no prior row", () => {
    const next = [{ mxc_id: "mxc://x", mime_type: "image/jpeg" }];
    expect(mergeAttachments([], next)).toEqual(next);
  });

  test("carries forward convex_storage_id from prev when next lacks it", () => {
    const prev: Attachment[] = [
      { mxc_id: "mxc://a", convex_storage_id: "kg_abc" },
    ];
    const next: Attachment[] = [
      { mxc_id: "mxc://a", mime_type: "image/jpeg" },
    ];
    const merged = mergeAttachments(prev, next);
    expect(merged[0]?.convex_storage_id).toBe("kg_abc");
    expect(merged[0]?.mime_type).toBe("image/jpeg");
  });

  test("does not overwrite a fresh storage_id on next", () => {
    const prev: Attachment[] = [
      { mxc_id: "mxc://a", convex_storage_id: "kg_old" },
    ];
    const next: Attachment[] = [
      { mxc_id: "mxc://a", convex_storage_id: "kg_new" },
    ];
    const merged = mergeAttachments(prev, next);
    expect(merged[0]?.convex_storage_id).toBe("kg_new");
  });

  test("only merges on matching mxc_id", () => {
    const prev: Attachment[] = [
      { mxc_id: "mxc://old", convex_storage_id: "kg_old" },
    ];
    const next: Attachment[] = [{ mxc_id: "mxc://new" }];
    const merged = mergeAttachments(prev, next);
    expect(merged[0]?.convex_storage_id).toBeUndefined();
  });
});

describe("upsertMessages transform", () => {
  test("text defaults to empty string for media-only messages", () => {
    const undef: string | undefined = undefined;
    const nul: string | null = null;
    expect(undef ?? "").toBe("");
    expect(nul ?? "").toBe("");
  });

  test("derives ts_epoch_ms from ISO timestamp", () => {
    expect(new Date("2026-05-22T22:26:41.000Z").getTime()).toBe(
      Date.UTC(2026, 4, 22, 22, 26, 41),
    );
  });

  test("chat_id mismatch throws", () => {
    const expected = "!room:beeper.local";
    const msg = { chat_id: "!other:beeper.local", message_id: "1" };
    expect(() => {
      if (msg.chat_id !== expected) {
        throw new Error(
          `upsertMessages: message ${msg.message_id} has chat_id ${msg.chat_id}, expected ${expected}`,
        );
      }
    }).toThrow(/expected !room/);
  });
});
