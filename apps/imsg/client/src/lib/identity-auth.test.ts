import { expect, test } from "bun:test";

if (process.env.COMMA_IDENTITY_AUTH_TEST_CHILD !== "1") {
  test("Convex confirming the boot token does not trigger a second Authenticate", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.filename], {
      cwd: import.meta.dir,
      env: { ...process.env, COMMA_IDENTITY_AUTH_TEST_CHILD: "1", EXPO_PUBLIC_CONVEX_URL: "https://example-123.convex.cloud" },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ exit, output: exit ? stdout + stderr : "" }).toEqual({ exit: 0, output: "" });
  });
} else {
  const sent: Array<{ type: string }> = [];
  let socket: { onmessage: ((event: { data: string }) => void) | null } | undefined;
  class FakeSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly url: string) {
      socket = this;
      setTimeout(() => { this.readyState = 1; this.onopen?.(); });
    }
    send(data: string) { sent.push(JSON.parse(data) as { type: string }); }
    close() { this.readyState = 3; setTimeout(() => this.onclose?.()); }
  }
  (globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
  const jwt = (n: number) => {
    const now = Math.floor(Date.now() / 1000);
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${part({ alg: "none" })}.${part({ iat: now, exp: now + 3600, n })}.sig`;
  };

  test("the boot token is reused: one Authenticate and no forced refresh after Convex confirms it", async () => {
    const { convexClient } = await import("./identity");
    const fetches: boolean[] = [];
    convexClient.setAuth(async ({ forceRefreshToken }) => { fetches.push(forceRefreshToken); return jwt(fetches.length); });
    for (let i = 0; i < 20 && !sent.some((m) => m.type === "Authenticate"); i++) await tick();
    const zero = "AAAAAAAAAAA=";
    socket?.onmessage?.({ data: JSON.stringify({
      type: "Transition", modifications: [], clientClockSkew: 0,
      startVersion: { querySet: 0, ts: zero, identity: 0 },
      endVersion: { querySet: 0, ts: zero, identity: 1 },
    }) });
    for (let i = 0; i < 10; i++) await tick();
    expect({ authenticates: sent.filter((m) => m.type === "Authenticate").length, fetches })
      .toEqual({ authenticates: 1, fetches: [false] });
    await convexClient.close();
  });
}
