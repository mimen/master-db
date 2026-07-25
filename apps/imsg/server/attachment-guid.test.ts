import { describe, expect, test } from "bun:test";
import { safeAttachmentGuid } from "./attachment-guid";

describe("safeAttachmentGuid", () => {
  test("keeps stable filename characters and replaces separators", () => {
    expect(safeAttachmentGuid("at_0:ABC/123-xyz")).toBe("at_0_ABC_123-xyz");
  });
});
