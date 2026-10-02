import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { createApp } from "./app";
import { FakeBlueBubbles } from "./bluebubbles-fake";
import type { Config } from "./config";
import { OverlayDb } from "./db";

const config: Config = {
  bbUrl: "fixture://bluebubbles",
  bbPassword: "fixture-only",
  hostname: "127.0.0.1",
  port: 0,
  dbPath: ":memory:",
  convexSiteUrl: null,
  appleContactsIngestSecret: null,
  convexCloudUrl: null,
  identityKey: null,
  whisper: { binaryPath: null, modelPath: null, workDir: "/tmp/imsg-test-whisper" },
  ai: {
    gatewayUrl: "http://127.0.0.1:9",
    gatewayKey: "",
    fastModel: "fixture",
    vaultPath: "/tmp",
    creatorRef: "imsg-test",
    ccsBin: "fixture-disabled",
    shadowSeat: "fixture-disabled",
    shadowCwd: "/tmp",
  },
};

const entry = "/_expo/static/js/web/entry-abc.js";
const entrySource = "console.log('comma');\n".repeat(400);
const html = `<!doctype html><html><body><div id="root"></div>${" ".repeat(2000)}</body></html>`;
const attachmentJson = JSON.stringify({ rows: "x".repeat(4000) });

let root: string;
let app: Awaited<ReturnType<typeof createApp>>["app"];
let dispose: () => void;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "comma-compression-"));
  mkdirSync(join(root, "_expo/static/js/web"), { recursive: true });
  for (const [path, text] of [[entry, entrySource], ["/index.html", html]] as const) {
    writeFileSync(join(root, path), text);
    writeFileSync(join(root, `${path}.br`), brotliCompressSync(text));
    writeFileSync(join(root, `${path}.gz`), Bun.gzipSync(new TextEncoder().encode(text)));
  }
  const bb = new FakeBlueBubbles({
    chats: Array.from({ length: 40 }, (_, index) => ({
      guid: `iMessage;-;+1555000${String(index).padStart(4, "0")}`,
      participants: [{ address: `+1555000${String(index).padStart(4, "0")}` }],
      messages: [{ guid: `m${index}`, text: `message ${index}`, dateCreated: 2000 + index, isFromMe: false }],
    })),
    attachments: {
      "att-json": {
        meta: { guid: "att-json", mimeType: "application/json", transferName: "data.json" },
        bytes: new TextEncoder().encode(attachmentJson),
      },
    },
  });
  ({ app, dispose } = await createApp({
    config,
    bb,
    db: new OverlayDb(":memory:"),
    now: () => 100_000,
    backgroundServices: false,
    shadowStatus: { available: false, detail: "fixture" },
    identity: { refresh: async () => {}, start() {}, stop() {}, search: () => [] },
    staticRoot: root,
  }));
});

afterAll(() => {
  dispose();
  rmSync(root, { recursive: true, force: true });
});

const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers });
const bytes = async (response: Response) => new Uint8Array(await response.arrayBuffer());

describe("static asset negotiation", () => {
  test("prefers br, then gzip, then identity, with Vary and the original Content-Type", async () => {
    const br = await get(entry, { "Accept-Encoding": "gzip, deflate, br" });
    expect(br.headers.get("Content-Encoding")).toBe("br");
    expect(brotliDecompressSync(await bytes(br)).toString()).toBe(entrySource);

    const gzip = await get(entry, { "Accept-Encoding": "gzip" });
    expect(gzip.headers.get("Content-Encoding")).toBe("gzip");
    expect(new TextDecoder().decode(Bun.gunzipSync(await bytes(gzip)))).toBe(entrySource);

    const identity = await get(entry);
    expect(identity.headers.get("Content-Encoding")).toBeNull();
    expect(await identity.text()).toBe(entrySource);

    for (const response of [br, gzip, identity]) {
      expect(response.headers.get("Vary")).toBe("Accept-Encoding");
      expect(response.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    }
  });

  test("honours q-values, including a refused encoding", async () => {
    const response = await get(entry, { "Accept-Encoding": "br;q=0, gzip;q=0.5" });
    expect(response.headers.get("Content-Encoding")).toBe("gzip");
  });

  test("HTML and the SPA rewrite stay no-store and are served compressed as text/html", async () => {
    for (const path of ["/", "/index.html", "/chat/some-guid"]) {
      const response = await get(path, { "Accept-Encoding": "br" });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Encoding")).toBe("br");
      expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(brotliDecompressSync(await bytes(response)).toString()).toBe(html);
    }
  });

  test("a range request gets the identity bytes", async () => {
    const response = await get(entry, { "Accept-Encoding": "br, gzip", Range: "bytes=0-9" });
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(await response.text()).toBe(entrySource);
  });
});

describe("JSON compression", () => {
  test("/api/chats?state=any is gzipped with Vary when accepted", async () => {
    const plain = await get("/api/chats?state=any");
    const plainText = await plain.text();
    expect(plain.headers.get("Content-Encoding")).toBeNull();
    expect(plain.headers.get("Vary")).toBe("Accept-Encoding");
    expect(plainText.length).toBeGreaterThan(1024);

    const gzip = await get("/api/chats?state=any", { "Accept-Encoding": "gzip, br" });
    expect(gzip.headers.get("Content-Encoding")).toBe("gzip");
    expect(gzip.headers.get("Vary")).toBe("Accept-Encoding");
    expect(gzip.headers.get("Content-Type")).toStartWith("application/json");
    expect(new TextDecoder().decode(Bun.gunzipSync(await bytes(gzip)))).toBe(plainText);
  });

  test("a range request on a compressed route stays identity", async () => {
    const response = await get("/api/chats?state=any", { "Accept-Encoding": "gzip", Range: "bytes=0-9" });
    expect(response.headers.get("Content-Encoding")).toBeNull();
  });
});

describe("never compressed", () => {
  test("the SSE event stream", async () => {
    const response = await get("/events", { "Accept-Encoding": "gzip, br" });
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("Content-Encoding")).toBeNull();
    await response.body!.cancel();
  });

  test("an attachment, even when its bytes are JSON", async () => {
    const response = await get("/api/attachments/att-json", { "Accept-Encoding": "gzip, br" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(await response.text()).toBe(attachmentJson);
  });
});
