import { expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { mediaApi, storedAttachmentUrl, storedAttachmentThumbnailUrl } from "./media-api";

test("media URLs use stored originals and thumbnails and never generate a Mini URL", () => {
  expect(storedAttachmentUrl("guid")).toBeNull();
  expect(storedAttachmentThumbnailUrl("guid")).toBeNull();
  expect(storedAttachmentUrl({})).toBeNull();
  expect(storedAttachmentThumbnailUrl({ thumbUrl: null, originalUrl: null })).toBeNull();
  expect(storedAttachmentUrl({ originalUrl: "https://convex.test/original" })).toBe("https://convex.test/original");
  expect(storedAttachmentThumbnailUrl({ thumbUrl: "https://convex.test/thumb", originalUrl: "https://convex.test/original" })).toBe("https://convex.test/thumb");
  expect(storedAttachmentThumbnailUrl({ thumbUrl: null, originalUrl: "https://convex.test/original" })).toBe("https://convex.test/original");
});
test("media references point to the owned Convex functions", () => {
  expect(getFunctionName(mediaApi.transcriptState)).toBe("comma/media:transcriptState");
  expect(getFunctionName(mediaApi.generateAttachmentUploadUrl)).toBe("comma/uploads:generateAttachmentUploadUrl");
});
