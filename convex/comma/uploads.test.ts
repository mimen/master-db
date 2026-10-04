import { makeFunctionReference } from "convex/server";
import type { ApiFromModules } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";

import { commaModules } from "./testModules.vitest";
import type * as Uploads from "./uploads";

const upload = makeFunctionReference("comma/uploads:generateAttachmentUploadUrl") as ApiFromModules<{ uploads: typeof Uploads }>["uploads"]["generateAttachmentUploadUrl"];
const finalizeUpload = makeFunctionReference("comma/uploads:finalizeUpload") as ApiFromModules<{ uploads: typeof Uploads }>["uploads"]["finalizeUpload"];
const modules = { ...commaModules, "../../comma/uploads.ts": () => import("./uploads") };

describe("outgoing uploads", () => {
  test("requires the allowed identity for issuance and finalization", async () => {
    const t = convexTest(schema, modules);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"], { type: "image/jpeg" })));
    for (const client of [t, t.withIdentity({ email: "other@example.com" })]) {
      await expect(client.mutation(upload, {})).rejects.toThrow("Unauthorized");
      await expect(client.mutation(finalizeUpload, { storageId, filename: "photo.jpg", mimeType: "image/jpeg" })).rejects.toThrow("Unauthorized");
    }
    expect(await t.withIdentity({ email: ALLOWED_EMAIL }).mutation(upload, {})).toMatch(/^https?:/);
  });
  test("verifies bytes, records metadata, and finalizes idempotently", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"], { type: "image/jpeg" })));
    const args = { storageId, filename: "photo.jpg", mimeType: "image/jpeg" };
    const id = await t.mutation(finalizeUpload, args);
    expect(await t.mutation(finalizeUpload, args)).toBe(id);
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ ...args, totalBytes: 5 });
    await expect(t.mutation(finalizeUpload, { ...args, filename: "changed.jpg" })).rejects.toThrow("metadata");
    await expect(t.mutation(finalizeUpload, { ...args, mimeType: "audio/mp4" })).rejects.toThrow("metadata");
    await expect(t.mutation(finalizeUpload, { ...args, filename: " " })).rejects.toThrow("required");
    await t.run((ctx) => ctx.storage.delete(storageId));
    await expect(t.mutation(finalizeUpload, args)).rejects.toThrow("not found");
  });
  test("rejects empty storage", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([], { type: "image/jpeg" })));
    await expect(t.mutation(finalizeUpload, { storageId, filename: "empty.jpg", mimeType: "image/jpeg" })).rejects.toThrow("empty");
  });
});
