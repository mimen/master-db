import { expect, mock, test } from "bun:test";
import type { ConversationId } from "@shared/types";

const stored = new Map<string, string>();
let hydrate: (value: string) => void = () => {};
const initial = new Promise<string>((resolve) => { hydrate = resolve; });
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => key === "imsg.drafts.v2" ? initial : stored.get(key) ?? null,
    setItem: async (key: string, value: string) => { stored.set(key, value); },
  },
}));
const { getDraft, hydrateDrafts, setDraft, subscribeDrafts } = await import("./drafts");

const id = (value: string) => value as ConversationId;

test("local edits win over hydration, invalid entries are dropped, and remote writes stay silent", async () => {
  const loading = hydrateDrafts();
  const alsoLoading = hydrateDrafts();
  const changes: string[] = [];
  const unsubscribe = subscribeDrafts((conversationId, text) => changes.push(`${conversationId}:${text}`));
  setDraft(id("typed"), "new edit");
  setDraft(id("cleared"), "");
  hydrate(JSON.stringify({ typed: "old", cleared: "old", invalid: 42, disk: "from disk" }));
  await Promise.all([loading, alsoLoading]);
  expect(getDraft(id("typed"))).toBe("new edit");
  expect(getDraft(id("cleared"))).toBe("");
  expect(getDraft(id("invalid"))).toBe("");
  expect(getDraft(id("disk"))).toBe("from disk");
  setDraft(id("remote"), "cloud", "remote");
  expect(getDraft(id("remote"))).toBe("cloud");
  expect(changes).toEqual(["typed:new edit", "cleared:"]);
  unsubscribe();
  setDraft(id("blank"), "   ");
  expect(getDraft(id("blank"))).toBe("");
  expect(changes).toHaveLength(2);
});
