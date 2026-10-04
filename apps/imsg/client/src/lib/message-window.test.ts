import { describe, expect, test } from "bun:test";
import type { Message } from "@shared/types";
import { foldReaction, hideSelfEchoes, mergeWindow, reconcileWindow, settleTemp, upsertMessage } from "./message-window";

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

  test("drops a failed row that is not this session's own send", () => {
    const orphan = message("tapback-1", "", 3_000, { error: 3, failed: true });
    expect(rows(mergeWindow([older, orphan, sent], [older, sent]))).toEqual([["m-1", "m-1", false], ["real-1", "real-1", false]]);
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

  test("drops a row inside the window's range that the window no longer contains", () => {
    const orphan = message("tapback-1", "", 3_000, { error: 3 });
    const fromOlderPage = message("m-0", "loaded from an older page", 500);
    expect(rows(reconcileWindow([fromOlderPage, older, orphan, sent], [older, sent]))).toEqual([
      ["m-0", "m-0", false],
      ["m-1", "m-1", false],
      ["real-1", "real-1", false],
    ]);
  });

  test("keeps this session's failed send", () => {
    const failed = { ...temp, dateCreated: 3_000, pending: false, failed: true };
    expect(rows(reconcileWindow([older, failed, sent], [older, sent]))).toEqual([
      ["m-1", "m-1", false],
      ["temp-1", "temp-1", false],
      ["real-1", "real-1", false],
    ]);
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

describe("hideSelfEchoes", () => {
  const msg = (guid: string, isFromMe: boolean, at: number, text = "same") =>
    ({ guid, isFromMe, dateCreated: at, text, attachments: [], reactions: [] }) as unknown as Message;
  test("drops the inbound copy iMessage echoes back in a note-to-self thread", () => {
    const thread = [msg("out", true, 1000, "one"), msg("echo", false, 1080, "one"),
      msg("out2", true, 2000, "two"), msg("echo2", false, 2050, "two"), msg("note", false, 9000, "a photo caption")];
    expect(hideSelfEchoes(thread).map((m) => m.guid)).toEqual(["out", "out2", "note"]);
  });
  test("keeps a genuine inbound message with the same text outside the echo window", () => {
    const thread = [msg("out", true, 1000), msg("reply", false, 1000 + 60_000)];
    expect(hideSelfEchoes(thread).map((m) => m.guid)).toEqual(["out", "reply"]);
  });
  test("an unsent note-to-self keeps one of its inbound copies", () => {
    const thread = [msg("out", true, 1000, "one"), msg("echo", false, 1080, "one"),
      msg("out2", true, 2000, "two"), msg("echo2", false, 2050, "two"),
      msg("u1", false, 3000, "unsent"), msg("u2", false, 3090, "unsent"), msg("u3", false, 3090, "unsent")];
    expect(hideSelfEchoes(thread).map((m) => m.guid)).toEqual(["out", "out2", "u1"]);
  });
  test("a real chat keeps someone's repeated message", () => {
    const thread = [msg("a", false, 1000, "hello?"), msg("b", false, 2000, "hello?"), msg("c", true, 9000, "hey")];
    expect(hideSelfEchoes(thread).map((m) => m.guid)).toEqual(["a", "b", "c"]);
  });
  test("a real chat where someone once repeats your words keeps their message", () => {
    const thread = [msg("a", true, 1000, "ok"), msg("b", false, 1500, "ok"), msg("c", true, 5000, "see you at 8"), msg("d", true, 9000, "bring the cables")];
    expect(hideSelfEchoes(thread).map((m) => m.guid)).toEqual(["a", "b", "c", "d"]);
  });
});
