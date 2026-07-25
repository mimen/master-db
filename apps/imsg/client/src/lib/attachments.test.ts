import { describe, expect, test } from "bun:test";
import {
  browserFilesToAttachments,
  MAX_PENDING_ATTACHMENTS,
  mergePendingAttachments,
  releaseObjectUrl,
} from "./attachments";

describe("browser attachment staging", () => {
  test("converts dropped and pasted files into staged assets", () => {
    const files = [
      new File(["image"], "photo.png", { type: "image/png" }),
      new File(["notes"], "notes.pdf", { type: "application/pdf" }),
    ];
    const assets = browserFilesToAttachments(files, (file) => `blob:${file.name}`);
    expect(assets).toEqual([
      {
        uri: "blob:photo.png",
        name: "photo.png",
        mime: "image/png",
        isImage: true,
        cleanup: "object-url",
      },
      {
        uri: "blob:notes.pdf",
        name: "notes.pdf",
        mime: "application/pdf",
        isImage: false,
        cleanup: "object-url",
      },
    ]);
  });

  test("releases generated object URLs but not picker-owned URIs", () => {
    const released: string[] = [];
    expect(
      releaseObjectUrl(
        { uri: "blob:pasted", cleanup: "object-url" },
        (uri) => released.push(uri),
      ),
    ).toBe(true);
    expect(releaseObjectUrl({ uri: "file://picked", cleanup: null }, (uri) => released.push(uri))).toBe(false);
    expect(released).toEqual(["blob:pasted"]);
  });

  test("keeps the first ten and reports overflow for cleanup", () => {
    const current = Array.from({ length: 8 }, (_, i) => `current-${i}`);
    const incoming = Array.from({ length: 5 }, (_, i) => `new-${i}`);
    const result = mergePendingAttachments(current, incoming);
    expect(result.items).toHaveLength(MAX_PENDING_ATTACHMENTS);
    expect(result.items.slice(-2)).toEqual(["new-0", "new-1"]);
    expect(result.rejected).toEqual(["new-2", "new-3", "new-4"]);
  });
});
