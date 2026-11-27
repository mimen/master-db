import { expect, test } from "bun:test";
import { parseCli, parseTarget, prepare } from "./prepare-draft";

test("--to tells a chat GUID, a conversation id, and an address apart", () => {
  expect(parseTarget("iMessage;-;+14155552671")).toEqual({ chatGuid: "iMessage;-;+14155552671" });
  expect(parseTarget("jd7a1x9k2m3n4p5q6r7s8t9v0w1y2z3a")).toEqual({ conversationId: "jd7a1x9k2m3n4p5q6r7s8t9v0w1y2z3a" });
  expect(parseTarget("(415) 555-2671")).toEqual({ address: "(415) 555-2671" });
  expect(parseTarget("14155552671000000000000000000")).toEqual({ address: "14155552671000000000000000000" });
  expect(parseTarget("sam@example.com")).toEqual({ address: "sam@example.com" });
});

test("--attach repeats and a draft needs text or an attachment", () => {
  expect(parseCli(["--to", "+14155552671", "--attach", "a.png", "--attach", "b.pdf"])).toMatchObject({ attach: ["a.png", "b.pdf"], text: "", force: false });
  expect(() => parseCli(["--to", "+14155552671", "--text", " "])).toThrow("--text, --attach");
  expect(() => parseCli(["--text", "hi"])).toThrow("--to");
});

test("a --to that resolves to nothing fails before any attachment uploads", async () => {
  const uploaded: string[] = [];
  const run = (fn: string) => {
    if (fn === "comma/drafts:resolveDraftTarget") throw new Error("No conversation for +15559999999");
    throw new Error(`unexpected ${fn}`);
  };
  const cli = parseCli(["--to", "+15559999999", "--attach", "a.png"]);
  await expect(prepare(cli, run, async (path) => { uploaded.push(path); return "storage"; })).rejects.toThrow("No conversation");
  expect(uploaded).toEqual([]);
});

test("a resolved --to uploads, then drafts into that conversation", async () => {
  const calls: unknown[] = [];
  const run = (fn: string, args: Record<string, unknown>) => {
    calls.push([fn, args]);
    return fn === "comma/drafts:resolveDraftTarget" ? "conv1" : { ok: true };
  };
  await prepare(parseCli(["--to", "+14155552671", "--attach", "a.png"]), run, async () => "storage1");
  expect(calls).toEqual([
    ["comma/drafts:resolveDraftTarget", { address: "+14155552671" }],
    ["comma/drafts:prepareDraft", { conversationId: "conv1", text: "", attachments: ["storage1"] }],
  ]);
});
