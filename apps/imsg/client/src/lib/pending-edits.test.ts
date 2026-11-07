import { describe, expect, test } from "bun:test";

import type { Message, Reaction } from "@shared/types";

import { applyPendingEdits, retirePendingEdits, type PendingEdit } from "./pending-edits";

const theirLove: Reaction = { key: "love", isFromMe: false, senderName: "Alex", senderAddress: "+15550001111" };
const myLike: Reaction = { key: "like", isFromMe: true, senderName: null, senderAddress: null };

function message(overrides: Partial<Message> = {}): Message {
  return {
    guid: "m1", chatGuid: "iMessage;-;+15550001111", text: "hi", dateCreated: 10, dateRead: null, dateDelivered: null,
    isFromMe: false, service: "iMessage", sender: null, attachments: [], reactions: [], replyToGuid: null,
    edited: false, retracted: false,
    ...overrides,
  } as Message;
}

const edits = (...entries: [string, PendingEdit][]) => new Map(entries);

describe("applyPendingEdits", () => {
  test("adds my reaction on top of the remote ones, which stay as the server has them", () => {
    const [shown] = applyPendingEdits([message({ reactions: [theirLove] })], edits(["m1", { kind: "react", key: "like", remove: false }]));
    expect(shown?.reactions).toEqual([theirLove, myLike]);
  });

  test("a reaction that arrives from someone else while mine is pending still shows", () => {
    const pending = edits(["m1", { kind: "react", key: "like", remove: false }]);
    const [shown] = applyPendingEdits([message({ reactions: [theirLove, { ...theirLove, key: "laugh" }] })], pending);
    expect(shown?.reactions.map((r) => [r.key, r.isFromMe])).toEqual([["love", false], ["laugh", false], ["like", true]]);
  });

  test("a new reaction of mine replaces my earlier one, and an emoji reaction carries its emoji", () => {
    const [shown] = applyPendingEdits([message({ reactions: [theirLove, myLike] })], edits(["m1", { kind: "react", key: "emoji:🔥", remove: false }]));
    expect(shown?.reactions).toEqual([theirLove, { ...myLike, key: "emoji:🔥", emoji: "🔥" }]);
  });

  test("removing my reaction leaves another sender's reaction of the same type", () => {
    const theirLike = { ...theirLove, key: "like" };
    const [shown] = applyPendingEdits([message({ reactions: [theirLike, myLike] })], edits(["m1", { kind: "react", key: "like", remove: true }]));
    expect(shown?.reactions).toEqual([theirLike]);
  });

  test("a retracted message disappears and its neighbours stay", () => {
    const shown = applyPendingEdits([message({ guid: "m0" }), message(), message({ guid: "m2" })], edits(["m1", { kind: "retract" }]));
    expect(shown.map((m) => m.guid)).toEqual(["m0", "m2"]);
  });

  test("an edit shows the new text, marked edited", () => {
    const [shown] = applyPendingEdits([message({ text: "helo" })], edits(["m1", { kind: "edit", text: "hello" }]));
    expect(shown).toMatchObject({ text: "hello", edited: true });
  });

  test("an intent for a message outside the window changes nothing", () => {
    const rows = [message()];
    expect(applyPendingEdits(rows, edits(["elsewhere", { kind: "retract" }]))).toEqual(rows);
  });
});

describe("retirePendingEdits", () => {
  test("a reaction retires only once the server shows my reaction", () => {
    const pending = edits(["m1", { kind: "react", key: "like", remove: false }]);
    expect(retirePendingEdits(pending, [message({ reactions: [theirLove] })])).toBe(pending);
    expect(retirePendingEdits(pending, [message({ reactions: [theirLove, myLike] })]).size).toBe(0);
  });

  test("another sender's matching reaction does not retire mine", () => {
    const pending = edits(["m1", { kind: "react", key: "like", remove: false }]);
    expect(retirePendingEdits(pending, [message({ reactions: [{ ...theirLove, key: "like" }] })])).toBe(pending);
  });

  test("a removal retires once my reaction is gone from the server", () => {
    const pending = edits(["m1", { kind: "react", key: "like", remove: true }]);
    expect(retirePendingEdits(pending, [message({ reactions: [myLike] })])).toBe(pending);
    expect(retirePendingEdits(pending, [message({ reactions: [] })]).size).toBe(0);
  });

  test("a retract retires when the server marks the row retracted or drops it", () => {
    const pending = edits(["m1", { kind: "retract" }]);
    expect(retirePendingEdits(pending, [message()])).toBe(pending);
    expect(retirePendingEdits(pending, [message({ retracted: true })]).size).toBe(0);
    expect(retirePendingEdits(pending, []).size).toBe(0);
  });

  test("an edit retires once the server text matches, and a stale text keeps it", () => {
    const pending = edits(["m1", { kind: "edit", text: "hello" }]);
    expect(retirePendingEdits(pending, [message({ text: "helo" })])).toBe(pending);
    expect(retirePendingEdits(pending, [message({ text: "hello", edited: true })]).size).toBe(0);
  });

  test("only the reflected intent retires", () => {
    const pending = edits(["m1", { kind: "edit", text: "hello" }], ["m2", { kind: "react", key: "like", remove: false }]);
    const next = retirePendingEdits(pending, [message({ text: "hello" }), message({ guid: "m2" })]);
    expect([...next.keys()]).toEqual(["m2"]);
  });
});
