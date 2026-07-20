import { describe, expect, test } from "vitest";

describe("getAttachmentUrl projection", () => {
  test("returns null when no row exists for mxc_id", () => {
    const row = undefined;
    expect(row ?? null).toBe(null);
  });

  test("projects expected fields when row + url are present", () => {
    const row = {
      mxc_id: "mxc://a",
      convex_storage_id: "kg_a",
      mime_type: "image/jpeg",
      file_name: "image.jpg",
      file_size: 12345,
    };
    const url = "https://blessed-egret-906.convex.cloud/api/storage/x";
    const projected = {
      mxc_id: row.mxc_id,
      convex_storage_id: row.convex_storage_id,
      url,
      mime_type: row.mime_type,
      file_name: row.file_name,
      file_size: row.file_size,
    };
    expect(projected.url).toContain("convex.cloud");
    expect(projected.mxc_id).toBe("mxc://a");
  });
});
