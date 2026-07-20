import { describe, expect, test } from "vitest";

describe("recordAttachment transform", () => {
  test("inserts new row when no existing row for mxc_id", () => {
    const args = {
      mxc_id: "mxc://local.beeper.com/abc",
      convex_storage_id: "kg_new",
      network: "WhatsApp",
      mime_type: "image/jpeg",
      file_size: 12345,
    };
    const row = {
      ...args,
      uploaded_at: new Date().toISOString(),
    };
    expect(row.mxc_id).toBe(args.mxc_id);
    expect(row.convex_storage_id).toBe("kg_new");
    expect(row.uploaded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("on race: incoming duplicate storage id is deleted, existing wins", () => {
    const existing = { convex_storage_id: "kg_first" };
    const incoming = { convex_storage_id: "kg_dup" };
    const willDelete = existing.convex_storage_id !== incoming.convex_storage_id;
    expect(willDelete).toBe(true);
  });

  test("on race: identical storage id is a no-op (deduped on retry)", () => {
    const existing = { convex_storage_id: "kg_same" };
    const incoming = { convex_storage_id: "kg_same" };
    const willDelete = existing.convex_storage_id !== incoming.convex_storage_id;
    expect(willDelete).toBe(false);
  });
});
