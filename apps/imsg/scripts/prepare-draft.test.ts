import { expect, test } from "bun:test";
import { parseCli, parseTarget } from "./prepare-draft";

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
