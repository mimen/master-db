import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ServerEvent } from "@shared/types";

class FakeEventSource {
  static all: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((msg: { data: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(): void {}
  close(): void {
    this.closed = true;
  }
}

mock.module("react-native", () => ({
  Platform: { OS: "web" },
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
mock.module("react-native-sse", () => ({ default: FakeEventSource }));
Object.assign(globalThis, {
  EventSource: FakeEventSource,
  document: { addEventListener() {}, removeEventListener() {} },
  window: { addEventListener() {}, removeEventListener() {} },
});

const { subscribeServerEvents } = await import("./sse");

const live = () => FakeEventSource.all.filter((s) => !s.closed);

describe("shared server event stream", () => {
  beforeEach(() => {
    FakeEventSource.all = [];
  });

  test("every subscriber shares one connection and receives each event", () => {
    const a: ServerEvent[] = [];
    const b: ServerEvent[] = [];
    const offA = subscribeServerEvents((e) => a.push(e));
    const offB = subscribeServerEvents((e) => b.push(e));
    const offC = subscribeServerEvents(() => {});

    expect(FakeEventSource.all.length).toBe(1);
    FakeEventSource.all[0]!.onmessage?.({ data: '{"kind":"chats-changed"}' });
    expect(a).toEqual([{ kind: "chats-changed" }]);
    expect(b).toEqual([{ kind: "chats-changed" }]);

    offA();
    offB();
    expect(live().length).toBe(1);
    offC();
    expect(live().length).toBe(0);
  });

  test("a reconnect fans resync out to every subscriber, but the first open does not", () => {
    const a: ServerEvent[] = [];
    const b: ServerEvent[] = [];
    const offA = subscribeServerEvents((e) => a.push(e));
    const offB = subscribeServerEvents((e) => b.push(e));
    const source = FakeEventSource.all[0]!;

    source.onopen?.();
    expect(a).toEqual([]);
    source.onopen?.();
    expect(a).toEqual([{ kind: "resync" }]);
    expect(b).toEqual([{ kind: "resync" }]);
    offA();
    offB();
  });

  test("unsubscribing twice does not close a connection others still use", () => {
    const offA = subscribeServerEvents(() => {});
    const offB = subscribeServerEvents(() => {});
    offA();
    offA();
    expect(live().length).toBe(1);
    offB();
    expect(live().length).toBe(0);
  });

  test("a subscriber after the last one left opens a fresh connection", () => {
    subscribeServerEvents(() => {})();
    const off = subscribeServerEvents(() => {});
    expect(FakeEventSource.all.length).toBe(2);
    expect(live().length).toBe(1);
    off();
  });
});
