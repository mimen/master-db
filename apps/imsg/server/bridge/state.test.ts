import { expect, spyOn, test } from "bun:test";
import { FakeBlueBubbles } from "../bluebubbles-fake";
import type { LeaseTimers } from "./commands/lease";
import { FakeIngest } from "./fake-ingest";
import { StatusPublisher, type ExecutorReport } from "./state";

function fixture() {
  let now = 1000;
  const bb = new FakeBlueBubbles({ chats: [] });
  const ingest = new FakeIngest();
  const report = (privateApi: boolean, detail?: string): ExecutorReport =>
    ({ connected: true, ...(detail ? { detail } : {}), capabilities: { executor: "imessage", privateApi, emojiReactions: false } });
  let capabilities = report(true, "missing");
  const intervals = new Map<number, () => void>();
  const timers: LeaseTimers = {
    setInterval: (cb, ms) => { intervals.set(ms, cb); return { unref() {}, ms } as unknown as ReturnType<typeof setInterval>; },
    clearInterval: (timer) => { intervals.delete((timer as unknown as { ms: number }).ms); },
  };
  const state = new StatusPublisher({ key: "imessage:acct", ingest, timers, now: () => now, report: () => capabilities,
    reconnects: (listener) => bb.onEvent((event) => { if (event.kind === "stream-connected") listener(); }) });
  return { bb, ingest, state, intervals, report, setNow: (value: number) => { now = value; },
    update: (value: ExecutorReport) => { capabilities = value; },
    rows: () => ingest.calls.filter((call) => call.kind === "ephemeral").map((call) => call.body.state) };
}

test("capabilities publish at startup, on change, every 60 seconds and on reconnect", async () => {
  const h = fixture();
  try {
    await h.state.flush();
    expect(h.rows()).toHaveLength(1);
    expect(h.rows()[0]).toMatchObject({ kind: "executorStatus", key: "imessage:acct", lastSeenAt: 1000, detail: "missing" });
    expect([...h.intervals.keys()].sort()).toEqual([1000, 60_000]);
    h.intervals.get(1000)?.(); await h.state.flush();
    expect(h.rows()).toHaveLength(1);
    h.setNow(61_000); h.intervals.get(60_000)?.(); await h.state.flush();
    expect(h.rows().at(-1)).toMatchObject({ lastSeenAt: 61_000 });
    h.update(h.report(false));
    h.intervals.get(1000)?.(); await h.state.flush();
    expect(h.rows().at(-1)).toMatchObject({ capabilities: { privateApi: false } });
    expect(h.rows().at(-1)).not.toHaveProperty("detail");
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
    h.update(h.report(false));
    h.setNow(100_000); h.ingest.fail = null;
    h.bb.emit({ kind: "stream-connected" }); await h.state.flush();
    expect(h.rows().at(-1)).toMatchObject({ capabilities: { privateApi: false }, lastSeenAt: 100_000 });
    expect(h.state.pending).toBe(0);
  } finally { h.state.stop(); log.mockRestore(); }
});
