import { expect, test } from "bun:test";
import type { ChatSummary, ConversationId, Message } from "@shared/types";
import { createInboundReadObserver, createReceiveSoundObserver } from "./message-observers";

const cid = (id: string) => id as ConversationId;
const chat = (guid: string, dateCreated: number, isFromMe = false, conversationId = "chat") => ({
  conversationId: cid(conversationId),
  lastMessage: { guid, dateCreated, isFromMe, text: guid, senderName: null, hasAttachments: false },
}) satisfies Pick<ChatSummary, "conversationId" | "lastMessage">;
const message = (guid: string, isFromMe = false, dateCreated = 0) => ({ guid, isFromMe, dateCreated, isGroupEvent: false, retracted: false }) as Message;

test("initial pages, new pagination pages and backfill are silent", () => {
  const sound = createReceiveSoundObserver(100);
  expect(sound.observe(null, 100)).toEqual([]);
  expect(sound.observe([chat("initial", 90)], 110)).toEqual([]);
  expect(sound.observe([chat("initial", 90), chat("page-two", 95, false, "other")], 120)).toEqual([]);
  expect(sound.observe([chat("backfill", 50)], 130)).toEqual([]);
});

test("live inbound GUIDs sound once; edits, reads, outbound and replay do not", () => {
  const sound = createReceiveSoundObserver(100);
  sound.observe([chat("initial", 90)], 110);
  expect(sound.observe([chat("inbound", 120)], 130)).toEqual(["inbound"]);
  expect(sound.observe([chat("inbound", 120)], 140)).toEqual([]);
  expect(sound.observe([chat("outbound", 150, true)], 160)).toEqual([]);
  expect(sound.observe([chat("inbound", 120)], 170)).toEqual([]);
  expect(sound.observe([chat("new-chat", 180, false, "new")], 190)).toEqual(["new-chat"]);
});

test("reconnection suppresses unseen catch-up then resumes live sound", () => {
  const sound = createReceiveSoundObserver(100);
  sound.observe([chat("initial", 90)], 110);
  sound.reconnect(120);
  expect(sound.observe([chat("during-gap", 130)], 140, false)).toEqual([]);
  sound.reconnect(200);
  expect(sound.observe([chat("catch-up", 190)], 210)).toEqual([]);
  expect(sound.observe([chat("live-again", 220)], 230)).toEqual(["live-again"]);
});

test("mounted reads follow new inbound GUIDs and ignore edits and outbound", () => {
  const reads = createInboundReadObserver();
  expect(reads.observe(cid("chat"), [], true)).toBe(false);
  expect(reads.observe(cid("chat"), [message("initial")], true), "the open already read the first page").toBe(false);
  expect(reads.observe(cid("chat"), [message("initial"), message("new")], true)).toBe(true);
  expect(reads.observe(cid("chat"), [message("initial"), message("new")], true)).toBe(false);
  expect(reads.observe(cid("chat"), [message("outbound", true)], true)).toBe(false);
  expect(reads.observe(cid("other"), [message("other-initial")], true)).toBe(false);
  expect(reads.observe(cid("other"), [message("other-initial"), message("other-new")], true)).toBe(true);
});

test("an older page loading into the thread does not mark it read again", () => {
  const reads = createInboundReadObserver();
  expect(reads.observe(cid("chat"), [message("newest", false, 500)], true)).toBe(false);
  expect(reads.observe(cid("chat"), [message("older", false, 100), message("newest", false, 500)], true)).toBe(false);
  expect(reads.observe(cid("chat"), [message("older", false, 100), message("newest", false, 500), message("arrived", false, 900)], true)).toBe(true);
});

test("a fetch filling in messages under the newest one the sidebar showed does not mark the thread read again", () => {
  const reads = createInboundReadObserver();
  expect(reads.observe(cid("chat"), [message("cached-newest", false, 900)], true)).toBe(false);
  expect(reads.observe(cid("chat"), [message("earlier", false, 700), message("cached-newest", false, 900)], true)).toBe(false);
});

test("preview threads do not consume inbound GUIDs; retractions do not mark read", () => {
  const reads = createInboundReadObserver();
  reads.observe(cid("chat"), [message("initial")], true);
  expect(reads.observe(cid("chat"), [message("new")], false)).toBe(false);
  expect(reads.observe(cid("chat"), [message("new")], true)).toBe(true);
  expect(reads.observe(cid("chat"), [{ ...message("retracted"), retracted: true }], true)).toBe(false);
});

test("a message stamped ahead of this device's clock still sounds", () => {
  const sound = createReceiveSoundObserver(100_000);
  sound.observe([chat("initial", 90_000)], 100_000);
  expect(sound.observe([chat("mac-clock-ahead", 105_000)], 101_000)).toEqual(["mac-clock-ahead"]);
});
