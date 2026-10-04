import { expect, spyOn, test } from "bun:test";
import { FakeBlueBubbles } from "../bluebubbles-fake";
import type { LeaseTimers } from "./commands/lease";
import { FakeIngest } from "./fake-ingest";
import { BridgeStatePublisher, type BridgeCapabilities } from "./state";

function fixture() {
  let now = 1000;
  const bb = new FakeBlueBubbles({ chats: [] });
  const ingest = new FakeIngest();
  let capabilities: BridgeCapabilities = { privateApi: true, suggestions: true, reactionSuggestions: true, whisperAvailable: false, whisperDetail: "missing" };
  const intervals = new Map<number, () => void>();
  const timers: LeaseTimers = {
    setInterval: (cb, ms) => { intervals.set(ms, cb); return { unref() {}, ms } as unknown as ReturnType<typeof setInterval>; },
    clearInterval: (timer) => { intervals.delete((timer as unknown as { ms: number }).ms); },
  };
  const state = new BridgeStatePublisher({ bb, ingest, timers, now: () => now, capabilities: () => capabilities });
  return { bb, ingest, state, intervals, setNow: (value: number) => { now = value; },
    update: (value: BridgeCapabilities) => { capabilities = value; },
    rows: () => ingest.calls.filter((call) => call.kind === "ephemeral").map((call) => call.body.state) };
}

test("capabilities publish at startup, on change, every 60 seconds and on reconnect", async () => {
  const h = fixture();
  try {
    await h.state.flush();
    expect(h.rows()).toHaveLength(1);
    expect(h.rows()[0]).toMatchObject({ kind: "bridgeState", key: "mini", lastSeenAt: 1000, whisperDetail: "missing" });
    expect([...h.intervals.keys()].sort()).toEqual([1000, 60_000]);
    h.intervals.get(1000)?.(); await h.state.flush();
    expect(h.rows()).toHaveLength(1);
    h.setNow(61_000); h.intervals.get(60_000)?.(); await h.state.flush();
    expect(h.rows().at(-1)).toMatchObject({ lastSeenAt: 61_000 });
    h.update({ privateApi: false, suggestions: false, reactionSuggestions: false, whisperAvailable: true });
    h.intervals.get(1000)?.(); await h.state.flush();
    expect(h.rows().at(-1)).toMatchObject({ privateApi: false, whisperAvailable: true });
    expect(h.rows().at(-1)).not.toHaveProperty("whisperDetail");
    h.setNow(62_000); h.bb.emit({ kind: "stream-connected" }); await h.state.flush();
    expect(h.rows().at(-1)).toMatchObject({ lastSeenAt: 62_000 });
    h.state.stop(); expect(h.intervals.size).toBe(0);
    const count = h.rows().length;
    h.bb.emit({ kind: "stream-connected" }); await h.state.flush();
    expect(h.rows()).toHaveLength(count);
  } finally { h.state.stop(); }
});

test("reconnect after ingest failure publishes current capabilities and a fresh timestamp", async () => {
  const h = fixture();
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    h.ingest.fail = "ephemeral";
    await h.state.flush();
    expect(h.state.pending).toBeGreaterThan(0);
    h.update({ privateApi: false, suggestions: true, reactionSuggestions: false, whisperAvailable: true });
    h.setNow(100_000); h.ingest.fail = null;
    h.bb.emit({ kind: "stream-connected" }); await h.state.flush();
    expect(h.rows().at(-1)).toMatchObject({ privateApi: false, lastSeenAt: 100_000 });
    expect(h.state.pending).toBe(0);
  } finally { h.state.stop(); log.mockRestore(); }
});
