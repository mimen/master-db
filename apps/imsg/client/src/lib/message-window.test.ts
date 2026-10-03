import { describe, expect, test } from "bun:test";
import type { Message } from "@shared/types";
import { foldReaction, mergeWindow, reconcileWindow, settleTemp, upsertMessage } from "./message-window";

const CHAT = "iMessage;-;+16195550101";

function message(guid: string, text: string, dateCreated: number, extra: Partial<Message> = {}): Message {
  return {
    guid,
    chatGuid: CHAT,
    text,
    dateCreated,
    dateRead: null,
    dateDelivered: null,
    isFromMe: true,
    service: "iMessage",
    sender: null,
    attachments: [],
    special: null,
    sendEffect: null,
    reactions: [],
    replyToGuid: null,
    replyToPreview: null,
    replyToFromMe: null,
    isGroupEvent: false,
    error: 0,
    edited: false,
    retracted: false,
    ...extra,
  };
}

const older = message("m-1", "see you at 8", 1_000, { isFromMe: false });
const temp = message("temp-1", "on my way", 5_000, { pending: true, clientKey: "temp-1" });
const sent = message("real-1", "on my way", 5_200);

const rows = (messages: Message[]) => messages.map((m) => [m.clientKey ?? m.guid, m.guid, m.pending === true]);

describe("a send settles into the optimistic row it started as", () => {
  test("echo before response", () => {
    const echoed = upsertMessage([older, temp], sent);
    expect(rows(echoed)).toEqual([["m-1", "m-1", false], ["temp-1", "real-1", false]]);
    const settled = settleTemp(echoed, "temp-1", sent);
    expect(rows(settled)).toEqual([["m-1", "m-1", false], ["temp-1", "real-1", false]]);
  });

  test("response before echo", () => {
    const settled = settleTemp([older, temp], "temp-1", sent);
    expect(rows(settled)).toEqual([["m-1", "m-1", false], ["temp-1", "real-1", false]]);
    const echoed = upsertMessage(settled, { ...sent, dateDelivered: 5_400 });
    expect(rows(echoed)).toEqual([["m-1", "m-1", false], ["temp-1", "real-1", false]]);
    expect(echoed[1]?.dateDelivered).toBe(5_400);
  });

  test("an echo whose text the server rewrote still settles into the temp's row", () => {
    const rewritten = { ...sent, text: "on my way " };
    const echoed = upsertMessage([older, temp], rewritten);
    expect(rows(echoed)).toEqual([["m-1", "m-1", false], ["temp-1", "temp-1", true], ["real-1", "real-1", false]]);
    expect(rows(settleTemp(echoed, "temp-1", rewritten))).toEqual([["m-1", "m-1", false], ["temp-1", "real-1", false]]);
  });

  test("a retried send settles into the failed bubble's row", () => {
    const failed = { ...temp, pending: false, failed: true };
    const revived = { ...failed, pending: true, failed: false };
    const retrying = settleTemp([older, failed], failed.guid, revived);
    expect(rows(retrying)).toEqual([["m-1", "m-1", false], ["temp-1", "temp-1", true]]);
    expect(rows(settleTemp(retrying, revived.guid, sent))).toEqual([["m-1", "m-1", false], ["temp-1", "real-1", false]]);
  });

  test("a later update to the settled message keeps its key", () => {
    const settled = settleTemp([older, temp], "temp-1", sent);
    const read = upsertMessage(settled, { ...sent, dateRead: 9_000 });
    expect(read.map((m) => [m.clientKey, m.dateRead])).toEqual([[undefined, null], ["temp-1", 9_000]]);
  });

  test("an echo never claims an old message with the same text", () => {
    const ok = message("temp-2", "ok", 100_000, { pending: true, clientKey: "temp-2" });
    const stale = message("old-ok", "ok", 1_000);
    expect(rows(upsertMessage([ok], stale))).toEqual([["old-ok", "old-ok", false], ["temp-2", "temp-2", true]]);
  });

  test("an inbound message with the same text leaves the pending send alone", () => {
    const inbound = message("in-1", "on my way", 5_100, { isFromMe: false });
    expect(rows(upsertMessage([temp], inbound))).toEqual([["temp-1", "temp-1", true], ["in-1", "in-1", false]]);
  });
});

describe("a window fetch that lands mid-send", () => {
  test("keeps the pending send the fetch could not see", () => {
    const merged = mergeWindow([older, temp], [older]);
    expect(rows(merged)).toEqual([["m-1", "m-1", false], ["temp-1", "temp-1", true]]);
  });

  test("keeps a settled send newer than the fetched window, under its key", () => {
    const settled = settleTemp([older, temp], "temp-1", sent);
    expect(rows(mergeWindow(settled, [older]))).toEqual([["m-1", "m-1", false], ["temp-1", "real-1", false]]);
  });

  test("takes the fetched copy of a send under the temp's key when the fetch already has it", () => {
    expect(rows(mergeWindow([older, temp], [older, sent]))).toEqual([["m-1", "m-1", false], ["temp-1", "real-1", false]]);
  });

  test("keeps a failed send", () => {
    const failed = { ...temp, pending: false, failed: true };
    expect(rows(mergeWindow([older, failed], [older]))).toEqual([["m-1", "m-1", false], ["temp-1", "temp-1", false]]);
  });

  test("drops what the window no longer contains when it is not newer", () => {
    const gone = message("m-0", "deleted", 500);
    expect(rows(mergeWindow([gone, older], [older]))).toEqual([["m-1", "m-1", false]]);
  });
});

describe("reconcile after an event-stream gap", () => {
  test("returns the same array when nothing changed", () => {
    const current = [older, { ...sent, clientKey: "temp-1" }];
    expect(reconcileWindow(current, [older, sent])).toBe(current);
  });

  test("settles a pending send whose echo was missed, under the temp's key", () => {
    expect(rows(reconcileWindow([older, temp], [older, sent]))).toEqual([["m-1", "m-1", false], ["temp-1", "real-1", false]]);
  });

  test("drops a retracted message", () => {
    expect(rows(reconcileWindow([older, sent], [older, { ...sent, retracted: true }]))).toEqual([["m-1", "m-1", false]]);
  });
});

describe("foldReaction custom emoji", () => {
  const marla = { isFromMe: false, senderName: "Marla", senderAddress: "+16195550101" };
  const event = (emoji: string | undefined, remove: boolean) => ({
    kind: "reaction" as const,
    chatGuid: CHAT,
    targetGuid: "t1",
    remove,
    reaction: { type: "emoji", ...(emoji ? { emoji } : {}), ...marla },
  });

  test("keeps different emoji from the same sender side by side", () => {
    const target = message("t1", "Hahaha", 1, { reactions: [{ type: "emoji", emoji: "😍", ...marla }] });
    expect(foldReaction(target, event("🔥", false)).reactions.map((r) => r.emoji)).toEqual(["😍", "🔥"]);
  });

  test("a removal drops only the matching emoji", () => {
    const target = message("t1", "Hahaha", 1, {
      reactions: [
        { type: "emoji", emoji: "😍", ...marla },
        { type: "emoji", emoji: "🔥", ...marla },
      ],
    });
    expect(foldReaction(target, event("😍", true)).reactions.map((r) => r.emoji)).toEqual(["🔥"]);
  });

  test("re-adding the same emoji does not duplicate it", () => {
    const target = message("t1", "Hahaha", 1, { reactions: [{ type: "emoji", emoji: "😍", ...marla }] });
    expect(foldReaction(target, event("😍", false)).reactions).toEqual([{ type: "emoji", emoji: "😍", ...marla }]);
  });
});
