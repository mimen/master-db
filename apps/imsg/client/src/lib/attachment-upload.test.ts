import { expect, test } from "bun:test";
import { uploadAndSendAttachmentVia, type AttachmentUploadDeps } from "./attachment-upload";
import type { Message } from "@shared/types";

function harness() {
  const calls: unknown[] = [];
  const message = { guid: "sent" } as Message;
  const deps: AttachmentUploadDeps = {
    generateUploadUrl: async () => { calls.push("issue"); return "https://convex.test/upload"; },
    finalizeUpload: async (args) => { calls.push({ finalize: args }); },
    send: async (chat, payload) => { calls.push({ chat, payload }); return { message }; },
    fetch: (async (url: string | Request | URL, init?: RequestInit) => { calls.push({ url, type: new Headers(init?.headers).get("Content-Type"), body: await (init!.body as Blob).text() }); return Response.json({ storageId: "file" }); }) as unknown as typeof fetch,
    readUri: async (uri) => { calls.push({ uri }); return new Blob(["voice"]); },
  };
  return { calls, message, deps };
}

test("uploads raw bytes, finalizes before enqueue, and preserves caption and voice flag", async () => {
  const { deps, calls, message } = harness();
  const options = { uri: "file://memo.m4a", filename: "memo.m4a", mimeType: "audio/mp4", caption: "listen", isAudioMessage: true };
  expect(await uploadAndSendAttachmentVia(deps, "chat", options)).toBe(message);
  expect(calls).toEqual([{ uri: options.uri }, "issue", { url: "https://convex.test/upload", type: "audio/mp4", body: "voice" }, { finalize: { storageId: "file", filename: "memo.m4a", mimeType: "audio/mp4" } }, { chat: "chat", payload: { kind: "sendAttachment", storageId: "file", filename: "memo.m4a", mimeType: "audio/mp4", caption: "listen", isAudioMessage: true } }]);
});

test("accepts a blob without reading a URI", async () => {
  const { deps, calls } = harness();
  await uploadAndSendAttachmentVia(deps, "chat", { blob: new Blob(["photo"]), filename: "photo.jpg", mimeType: "image/jpeg", isAudioMessage: false });
  expect(calls[0]).toBe("issue");
  expect(calls.at(-1)).toMatchObject({ payload: { isAudioMessage: false } });
});

test("failed upload, malformed response, or finalization never enqueues a send", async () => {
  for (const response of [new Response("failure", { status: 500 }), Response.json({}), Response.json({ storageId: "file" })]) {
    const { deps, calls } = harness();
    deps.fetch = (async () => response) as unknown as typeof fetch;
    deps.finalizeUpload = async () => { throw new Error("missing storage"); };
    await expect(uploadAndSendAttachmentVia(deps, "chat", { blob: new Blob(["photo"]), filename: "photo.jpg", mimeType: "image/jpeg", isAudioMessage: false })).rejects.toThrow();
    expect(calls.some((a) => typeof a === "object" && a && "payload" in a)).toBe(false);
  }
});

test("native file URIs upload an ArrayBuffer without constructing a React Native Blob", async () => {
  const { deps, calls } = harness();
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  deps.readUri = async () => bytes;
  deps.fetch = async (_, init) => { expect(init?.body).toBe(bytes); expect(new Headers(init?.headers).get("Content-Type")).toBe("audio/mp4"); return Response.json({ storageId: "file" }); };
  await uploadAndSendAttachmentVia(deps, "chat", { uri: "file://memo.m4a", filename: "memo.m4a", mimeType: "audio/mp4", isAudioMessage: true });
  expect(calls.at(-1)).toMatchObject({ payload: { isAudioMessage: true } });
});
