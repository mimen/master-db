import { expect, test } from "bun:test";
import { version } from "convex";
import { BaseConvexClient } from "convex/browser";

import { bootScript, bootWebSocket, convexSocketUrl, type BootHandoff } from "./boot-handoff";

class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  readyState = FakeSocket.CONNECTING;
  closed = false;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  constructor(readonly url: string) { super(); }
  close() { this.closed = true; this.readyState = 3; }
  send(data: string) { this.sent.push((JSON.parse(data) as { type: string }).type); }
  override dispatchEvent(event: Event) {
    if (event.type === "open") this.onopen?.(event);
    return super.dispatchEvent(event);
  }
}
const Socket = FakeSocket as unknown as typeof WebSocket;
const URL = "wss://example.convex.cloud/api/1.0.0/sync";

test("the boot socket URL is the one the Convex client opens", () => {
  const urls: string[] = [];
  const client = new BaseConvexClient("https://example-123.convex.cloud", () => {}, {
    webSocketConstructor: class extends FakeSocket { constructor(url: string) { super(url); urls.push(url); } } as unknown as typeof WebSocket,
    unsavedChangesWarning: false,
  });
  void client.close();
  expect(urls).toEqual([convexSocketUrl("https://example-123.convex.cloud", version)]);
});

test("the client takes the boot socket once, then opens its own", () => {
  const early = new FakeSocket(URL);
  const boot: BootHandoff = { socket: early as unknown as WebSocket };
  const Boot = bootWebSocket(boot, Socket);
  expect(new Boot(URL)).toBe(early as unknown as WebSocket);
  const second = new Boot(URL);
  expect(second).not.toBe(early as unknown as WebSocket);
  expect(second.url).toBe(URL);
});

test("a boot socket for another URL or already closed is discarded, not reused", () => {
  for (const early of [new FakeSocket("wss://other/sync"), Object.assign(new FakeSocket(URL), { readyState: 3 })]) {
    const Boot = bootWebSocket({ socket: early as unknown as WebSocket }, Socket);
    expect(new Boot(URL)).not.toBe(early as unknown as WebSocket);
    expect(early.closed).toBe(true);
  }
});

test("the Convex client connects on a boot socket that opened before it was taken", async () => {
  const early = Object.assign(new FakeSocket(convexSocketUrl("https://example-123.convex.cloud", version)), { readyState: FakeSocket.OPEN });
  const client = new BaseConvexClient("https://example-123.convex.cloud", () => {}, {
    webSocketConstructor: bootWebSocket({ socket: early as unknown as WebSocket }, Socket),
    unsavedChangesWarning: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(early.sent[0]).toBe("Connect");
  void client.close();
});

test("the boot script opens the Convex socket and requests the token before the bundle runs", () => {
  const sockets: string[] = [];
  const fetched: string[] = [];
  const window: { __commaBoot?: BootHandoff } = {};
  new Function("window", "WebSocket", "fetch", bootScript(URL))(
    window,
    class { constructor(url: string) { sockets.push(url); } },
    (url: string) => { fetched.push(url); return Promise.reject(new Error("offline")); },
  );
  expect(sockets).toEqual([URL]);
  expect(fetched).toEqual(["/api/convex-token"]);
  expect(window.__commaBoot?.socket).toBeDefined();
  expect(window.__commaBoot?.token).toBeInstanceOf(Promise);
});
