import { expect, test } from "bun:test";
import { createDraftSync, mergeRemoteDraft } from "./draft-sync";

const idle = { text: "", focused: false, dirty: false, pending: false, initial: true, updatedAt: 0 };

test("remote text seeds an empty input but not a nonempty initial local draft", () => {
  expect(mergeRemoteDraft(idle, { text: "cloud", updatedAt: 10 })).toBe("cloud");
  expect(mergeRemoteDraft({ ...idle, text: "local" }, { text: "cloud", updatedAt: 10 })).toBeUndefined();
});

test("newest remote text wins unless typing or a local save is pending", () => {
  const loaded = { ...idle, text: "local", initial: false, updatedAt: 10 };
  expect(mergeRemoteDraft(loaded, { text: "new", updatedAt: 20 })).toBe("new");
  expect(mergeRemoteDraft(loaded, { text: "old", updatedAt: 5 })).toBeUndefined();
  expect(mergeRemoteDraft({ ...loaded, focused: true, dirty: true }, { text: "new", updatedAt: 20 })).toBeUndefined();
  expect(mergeRemoteDraft({ ...loaded, pending: true }, null)).toBeUndefined();
  expect(mergeRemoteDraft({ ...loaded, focused: true }, null)).toBe("");
  expect(mergeRemoteDraft({ ...loaded, dirty: true }, null)).toBe("");
});

function setup(write?: (text: string) => Promise<unknown>) {
  const saved: string[] = [];
  const merged: string[] = [];
  const errors: string[] = [];
  const sync = createDraftSync({
    text: "",
    write: write ?? (async (text) => { saved.push(text); }),
    onRemote: (text) => merged.push(text),
    onError: () => errors.push("failed"),
  });
  return { sync, saved, merged, errors };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("debounce coalesces keystrokes and resets the 600ms quiet window", async () => {
  const { sync, saved } = setup();
  sync.save("a");
  await wait(350);
  sync.save("ab");
  await wait(350);
  expect(saved).toEqual([]);
  await wait(350);
  expect(saved).toEqual(["ab"]);
  await sync.flush();
});

test("blur and chat-switch cleanup flush immediately without duplicate timer writes", async () => {
  const first = setup();
  first.sync.save("blur");
  await first.sync.blur();
  expect(first.saved).toEqual(["blur"]);
  const second = setup();
  second.sync.save("switch");
  await second.sync.flush();
  expect(second.saved).toEqual(["switch"]);
  await wait(650);
  expect(first.saved).toEqual(["blur"]);
  expect(second.saved).toEqual(["switch"]);
});

test("a clear cancels the old draft and saves deletion immediately", async () => {
  const { sync, saved } = setup();
  sync.save("unsent");
  sync.save("");
  await sync.flush();
  expect(saved).toEqual([""]);
});

test("a saved but focused dirty input still ignores remote text until blur", async () => {
  const { sync, merged } = setup();
  sync.receive(null);
  sync.focus();
  sync.save("typing");
  await sync.flush();
  sync.receive({ text: "other device", updatedAt: 20 });
  expect(merged).toEqual([]);
  await sync.blur();
  sync.receive({ text: "latest", updatedAt: 30 });
  sync.receive({ text: "stale", updatedAt: 25 });
  sync.receive(null);
  expect(merged).toEqual(["latest", ""]);
});

test("writes stay ordered across an in-flight save and a clear", async () => {
  let complete: () => void = () => {};
  const saved: string[] = [];
  const { sync } = setup(async (text) => {
    saved.push(text);
    if (text) await new Promise<void>((resolve) => { complete = resolve; });
  });
  sync.save("first");
  const first = sync.flush();
  await Promise.resolve();
  sync.save("");
  const clear = sync.flush();
  expect(saved).toEqual(["first"]);
  complete();
  await first;
  await clear;
  expect(saved).toEqual(["first", ""]);
});

test("failed saves retain the text for retry on blur", async () => {
  const saved: string[] = [];
  let fail = true;
  const { sync, errors, merged } = setup(async (text) => {
    if (fail) throw new Error("offline");
    saved.push(text);
  });
  sync.save("keep me");
  await sync.flush();
  sync.receive(null);
  expect(errors).toEqual(["failed"]);
  expect(merged).toEqual([]);
  fail = false;
  await sync.blur();
  expect(saved).toEqual(["keep me"]);
});
