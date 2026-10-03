import { expect, mock, test } from "bun:test";

const stored = new Map<string, string>();
let hydrate: (value: string) => void = () => {};
const initial = new Promise<string>((resolve) => { hydrate = resolve; });
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => key === "imsg.drafts.v1" ? initial : stored.get(key) ?? null,
    setItem: async (key: string, value: string) => { stored.set(key, value); },
  },
}));
const { getDraft, hydrateDrafts, setDraft, subscribeDrafts, uploadLocalDrafts } = await import("./drafts");

test("local fallback, remote caching, safe hydration and a bounded one-time cloud import", async () => {
  const loading = hydrateDrafts();
  const alsoLoading = hydrateDrafts();
  const changes: string[] = [];
  const unsubscribe = subscribeDrafts((guid, text) => changes.push(`${guid}:${text}`));
  setDraft("typed", "new edit");
  setDraft("cleared", "");
  hydrate(JSON.stringify({ typed: "old", cleared: "old", invalid: 42, disk: "from disk" }));
  await Promise.all([loading, alsoLoading]);
  expect(getDraft("typed")).toBe("new edit");
  expect(getDraft("cleared")).toBe("");
  expect(getDraft("invalid")).toBe("");
  expect(getDraft("disk")).toBe("from disk");
  setDraft("remote", "cloud", "remote");
  expect(getDraft("remote")).toBe("cloud");
  expect(changes).toEqual(["typed:new edit", "cleared:"]);
  unsubscribe();
  setDraft("blank", "   ");
  for (let i = 0; i < 55; i++) setDraft(`chat-${i}`, `draft-${i}`);
  const uploaded: string[] = [];
  await expect(uploadLocalDrafts(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  const write = async (guid: string, text: string) => { uploaded.push(`${guid}:${text}`); };
  await Promise.all([uploadLocalDrafts(write), uploadLocalDrafts(write)]);
  expect(uploaded).toHaveLength(50);
  expect(uploaded.slice(0, 3)).toEqual(["typed:new edit", "disk:from disk", "remote:cloud"]);
  expect(new Set(uploaded).size).toBe(50);
  await uploadLocalDrafts(write);
  expect(uploaded).toHaveLength(50);
  expect(stored.get("imsg.drafts.v1.convex-uploaded")).toBe("1");
});
