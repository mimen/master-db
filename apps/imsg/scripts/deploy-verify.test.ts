import { describe, expect, test } from "bun:test";

describe("deploy verification entrypoint", () => {
  test("is import-safe so verification only runs as a command", async () => {
    await expect(import("./deploy-verify")).resolves.toBeDefined();
  });
});
