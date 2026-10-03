import { expect, test } from "bun:test";
import type { Message } from "@shared/types";
import { createLiveMessagePreview } from "./live-message";
import { mergeConvexMessages } from "./convex-adapters";
import { upsertMessage } from "./message-window";

const message = (guid: string, dateCreated = 20): Message => ({
  guid, chatGuid: "nina", dateCreated, text: "Production signed off", isFromMe: false,
  dateRead: null, dateDelivered: null, service: "iMessage", sender: null, attachments: [],
  reactions: [], replyToGuid: null, replyToPreview: null, replyToFromMe: null,
  special: null, sendEffect: null, isGroupEvent: false, error: 0, edited: false, retracted: false,
});

test("a sidebar-seen stream message is available before opening history resolves", () => {
  const preview = createLiveMessagePreview();
  const inbound = message("inbound");
  preview.receive({ kind: "new-message", chatGuid: "nina", message: inbound });
  expect(preview.withHistory("alex", [])).toEqual([]);
  expect(preview.withHistory("nina", [])).toEqual([inbound]);
  const older = message("older", 10);
  expect(preview.withHistory("nina", [older])).toEqual([older, inbound]);
  const mirrored = { ...inbound, dateRead: 30 };
  expect(preview.withHistory("nina", [older, mirrored])).toEqual([older, mirrored]);
  expect(preview.withHistory("nina", [])).toEqual([]);
});

test("a newer history row, retraction, or stream resync retires the preview", () => {
  for (const clear of ["history", "retraction", "resync"] as const) {
    const preview = createLiveMessagePreview();
    const inbound = message("inbound");
    preview.receive({ kind: "new-message", chatGuid: "nina", message: inbound });
    if (clear === "history") preview.withHistory("nina", [message("newer", 30)]);
    if (clear === "retraction") preview.receive({ kind: "updated-message", chatGuid: "nina", message: { ...inbound, retracted: true } });
    if (clear === "resync") preview.receive({ kind: "resync" });
    expect(preview.withHistory("nina", [])).toEqual([]);
  }
});

test("retains only the newest message per chat and bounds inactive chats", () => {
  const preview = createLiveMessagePreview(2);
  const inbound = message("latest");
  preview.receive({ kind: "new-message", chatGuid: "nina", message: inbound });
  preview.receive({ kind: "updated-message", chatGuid: "nina", message: message("older", 10) });
  expect(preview.withHistory("nina", [])).toEqual([inbound]);
  preview.receive({ kind: "new-message", chatGuid: "alex", message: message("alex") });
  preview.receive({ kind: "new-message", chatGuid: "jordan", message: message("jordan") });
  expect(preview.withHistory("nina", [])).toEqual([]);
});

test("an outgoing SSE echo cannot duplicate a send while its Convex mirror lags", () => {
  const preview = createLiveMessagePreview();
  const optimistic = { ...message("temp-local-key"), isFromMe: true, clientKey: "temp-local-key", pending: true };
  const queued = { ...optimistic, guid: "temp-temp-local-key" };
  const echo = { ...message("real-send", 21), isFromMe: true };
  preview.receive({ kind: "new-message", chatGuid: "nina", message: echo });
  const local = upsertMessage([optimistic], echo);
  const merged = mergeConvexMessages(preview.withHistory("nina", [queued]), local);
  expect(merged).toHaveLength(1);
  expect(merged[0].clientKey).toBe("temp-local-key");
  expect(preview.withHistory("nina", [])).toEqual([]);
});
