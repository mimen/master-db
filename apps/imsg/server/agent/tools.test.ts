import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commaTools, scratchPath } from "./tools";
import type { Port, Routes } from "./convex-port";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function harness(responses: Partial<{ [K in keyof Routes]: Routes[K][1] }> = {}) {
  const scratchDir = mkdtempSync(join(tmpdir(), "comma-agent-tools-"));
  roots.push(scratchDir);
  const calls: { route: string; body: unknown }[] = [];
  const uploads: { size: number; mime: string }[] = [];
  const port: Port = {
    post: async (route, body) => { calls.push({ route, body }); return (responses[route] ?? null) as never; },
    upload: async (bytes, mime) => { uploads.push({ size: bytes.length, mime }); return `storage-${uploads.length}`; },
  };
  const png = new Uint8Array([137, 80, 78, 71]);
  const fetch = async (url: string) => url.endsWith("missing") ? new Response("no", { status: 404 }) : new Response(png, { headers: { "content-type": "image/png" } });
  const tools = commaTools({ port, chatId: "chat-1", conversationId: "conv-1", scratchDir, timeZone: "UTC", fetch });
  const call = (name: string, args: Record<string, unknown> = {}) => tools.find((t) => t.name === name)!.handler(args as never, {});
  return { call, calls, uploads, scratchDir };
}

describe("comma tools", () => {
  test("scratch paths cannot escape the chat's folder", () => {
    expect(scratchPath("/s/chat", "flyer.png")).toBe("/s/chat/flyer.png");
    expect(scratchPath("/s/chat", "/s/chat/out/a.csv")).toBe("/s/chat/out/a.csv");
    expect(() => scratchPath("/s/chat", "../other/secret")).toThrow("outside the scratch folder");
    expect(() => scratchPath("/s/chat", "/etc/passwd")).toThrow("outside the scratch folder");
    expect(() => scratchPath("/s/chat", "/s/chat")).toThrow("outside the scratch folder");
  });

  test("attach_file uploads a scratch file and set_draft places it with the reply once", async () => {
    const h = harness({ agentRecordUpload: { storageId: "storage-1", size: 4 }, agentDraft: { placed: "composer" } });
    writeFileSync(join(h.scratchDir, "flyer.png"), new Uint8Array([1, 2, 3, 4]));
    expect((await h.call("attach_file", { path: "flyer.png" })).isError).toBeUndefined();
    expect(h.calls[0]).toEqual({ route: "agentRecordUpload", body: { storageId: "storage-1", filename: "flyer.png", mimeType: "image/png" } });
    const placed = await h.call("set_draft", { text: "You're both on the list", note: "Added to Freaquency" });
    expect(placed.content).toEqual([{ type: "text", text: "The draft is in the composer." }]);
    expect(h.calls[1]).toMatchObject({ route: "agentDraft", body: { chatId: "chat-1", conversationId: "conv-1", text: "You're both on the list", note: "Added to Freaquency", attachments: ["storage-1"] } });
    await h.call("set_draft", { text: "second" });
    expect(h.calls[2].body).not.toHaveProperty("attachments");
  });

  test("set_draft reports a collision with Milad's typed text", async () => {
    const h = harness({ agentDraft: { placed: "pane" } });
    const result = await h.call("set_draft", { text: "hi" });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Use in composer") });
  });

  test("attach_file refuses a path outside the scratch folder without uploading", async () => {
    const h = harness();
    const result = await h.call("attach_file", { path: "../../etc/hosts" });
    expect(result.isError).toBe(true);
    expect(h.uploads).toEqual([]);
  });

  test("send_message enqueues an outbox send for the bound conversation", async () => {
    const h = harness();
    await h.call("send_message", { text: "See you there" });
    expect(h.calls).toEqual([{ route: "agentSend", body: { conversationId: "conv-1", clientKey: expect.stringMatching(/^agent-/), text: "See you there" } }]);
  });

  test("get_attachment saves the file and returns images for the model to see", async () => {
    const h = harness({ agentAttachment: { url: "https://files/flyer", name: "flyer.png", mime: "image/png" } });
    const result = await h.call("get_attachment", { guid: "att-1" });
    expect(result.content[0]).toEqual({ type: "image", data: Buffer.from([137, 80, 78, 71]).toString("base64"), mimeType: "image/png" });
    expect(await Bun.file(join(h.scratchDir, "flyer.png")).bytes()).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  test("read_thread pages back from a timestamp", async () => {
    const h = harness({ agentContext: { title: "Jesse", participants: [], messages: [{ guid: "g", at: Date.UTC(2026, 9, 19, 18), fromMe: false, sender: "Jesse", text: "list?", attachments: [] }] } });
    const result = await h.call("read_thread", { beforeMessageAt: 5, limit: 10 });
    expect(h.calls[0]).toEqual({ route: "agentContext", body: { conversationId: "conv-1", beforeMessageAt: 5, limit: 10 } });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Jesse: list?") });
  });
});
