import { expect, test } from "bun:test";
import type { ConvexIngest } from "../convex-ingest";
import { deleteMirroredChat } from "./messaging-ingest";

test("deletion advances each bounded ingest page until completion", async () => {
  const calls: unknown[] = [];
  const pages = [{ done: false, phase: "messages", cursor: "next" }, { done: false, phase: "attachments" }, { done: true }];
  const ingest = { post: async (...args: unknown[]) => { calls.push(args); return pages.shift(); } } as unknown as Pick<ConvexIngest, "post">;
  await deleteMirroredChat(ingest, "alias");
  expect(calls).toEqual([
    ["deleteChat", { chatGuid: "alias" }],
    ["deleteChat", { chatGuid: "alias", phase: "messages", cursor: "next" }],
    ["deleteChat", { chatGuid: "alias", phase: "attachments" }],
  ]);
});

test("a lost lease stops mirror deletion before the next page", async () => {
  const controller = new AbortController();
  let count = 0;
  const ingest = { post: async () => { count++; controller.abort(new Error("lease lost")); return { done: false, phase: "messages", cursor: "next" }; } } as unknown as Pick<ConvexIngest, "post">;
  await expect(deleteMirroredChat(ingest, "alias", controller.signal)).rejects.toThrow("lease lost");
  expect(count).toBe(1);
});
