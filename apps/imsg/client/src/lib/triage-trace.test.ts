import { afterEach, expect, test } from "bun:test";
import { traceTriage } from "./triage-trace";

const data = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } });
afterEach(() => data.clear());

test("records why ⌘E did not advance, with guids shortened and capped at 40 entries", () => {
  for (let i = 0; i < 45; i++) traceTriage({ kind: "advance", from: `iMessage;-;+1555000${i}`, to: null, reason: "no next" });
  const ring = JSON.parse(data.get("imsg.triageTrace")!) as Array<{ from: string; reason: string }>;
  expect(ring).toHaveLength(40);
  expect(ring.at(-1)).toMatchObject({ from: "500044", reason: "no next" });
});

test("records a modifier chord with its physical key and the command it matched", () => {
  traceTriage({ kind: "key", combo: "cmd+e", code: "KeyE", command: "conversation.settle" });
  traceTriage({ kind: "menu", command: "navigation.close" });
  expect(JSON.parse(data.get("imsg.triageTrace")!)).toMatchObject([
    { kind: "key", combo: "cmd+e", code: "KeyE", command: "conversation.settle" },
    { kind: "menu", command: "navigation.close" },
  ]);
});
