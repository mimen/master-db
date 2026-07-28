import { describe, expect, test } from "bun:test";
import { FakeBlueBubbles } from "./bluebubbles-fake";
import { ChatDirectory } from "./chat-directory";
import { ContactBook } from "./contacts";
import { OverlayDb } from "./db";
import {
  FIXTURE_ARCHIVED_GUIDS,
  FIXTURE_DM_THREAD_GUID,
  FIXTURE_GROUP_THREAD_GUID,
  FIXTURE_READ_UNRESPONDED_GUID,
  buildFixtureSeed,
} from "./render-fixture";
import { computeCounts } from "../shared/chat-state";
import type { ChatSummary } from "../shared/types";

/**
 * The render's captures are only worth trusting if the fixture actually lands
 * in the states the shot list claims to be photographing. Nothing else pins
 * that: the shot list matches lens counts with `\d+`, so an edit here could
 * quietly change what every capture shows while the render still "passes".
 *
 * This runs the fixture through the real Chat Directory and the real Chat State
 * rules — not a restatement of them — so the numbers below are the same ones
 * the app derives.
 */
async function directoryUnderRenderConditions(): Promise<ChatSummary[]> {
  const bb = new FakeBlueBubbles(buildFixtureSeed());
  const db = new OverlayDb(":memory:");
  const contacts = new ContactBook(bb);
  await contacts.refresh(true);
  const directory = new ChatDirectory(bb, db, contacts, Date.now);
  // The render archives through the API at boot; Overlay state is the same either way.
  for (const guid of FIXTURE_ARCHIVED_GUIDS) directory.setArchived(guid, true);

  const result = await directory.summaries();
  if (!result.ok) throw new Error(`fixture directory failed to build: ${result.error}`);
  return result.chats;
}

describe("render fixture", () => {
  test("lands in the lens counts the shot list photographs", async () => {
    const counts = computeCounts(await directoryUnderRenderConditions(), "all");
    expect(counts).toEqual({ all: 12, unread: 4, unresponded: 8, waiting: 4, archived: 3 });
  });

  test("every conversation resolves to a contact, so none is screened as Unknown", async () => {
    // An unresolved participant makes a chat "unknown", which drops it out of
    // every lens except Unknown — a silent way for the captures to go empty.
    const chats = await directoryUnderRenderConditions();
    expect(chats.length).toBeGreaterThan(0);
    expect(chats.filter((chat) => !chat.known)).toEqual([]);
    expect(chats.filter((chat) => chat.isSpam)).toEqual([]);
  });

  test("the threads the captures open exist and carry messages", async () => {
    const chats = await directoryUnderRenderConditions();
    for (const guid of [FIXTURE_GROUP_THREAD_GUID, FIXTURE_DM_THREAD_GUID]) {
      const chat = chats.find((candidate) => candidate.guid === guid);
      expect(chat).toBeDefined();
      expect(chat?.lastMessage?.text ?? "").not.toBe("");
    }
  });

  test("the conversation opened before the list captures costs no unread badge", async () => {
    // The shot list opens Dmitri first so the split pane is never empty. That
    // is only safe while he carries nothing unread — otherwise every following
    // list capture silently loses a badge.
    const chats = await directoryUnderRenderConditions();
    const opened = chats.find((chat) => chat.guid === FIXTURE_READ_UNRESPONDED_GUID);
    expect(opened).toBeDefined();
    expect(opened?.unreadCount).toBe(0);
    expect(opened?.flags.unresponded).toBe(true);
  });

  test("holds no phone number outside the fictional 555-01xx range", async () => {
    // The whole point of the fixture. A realistic number would also collide
    // with the real avatar cache, which is keyed on the last ten digits.
    const chats = await directoryUnderRenderConditions();
    const addresses = chats.flatMap((chat) => chat.participants.map((p) => p.address));
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.filter((address) => !/^\+155555501\d\d$/.test(address))).toEqual([]);
  });

  test("holds no URL, which would make the link-preview route fetch the live web", async () => {
    const seed = buildFixtureSeed();
    const texts = seed.chats.flatMap((chat) => chat.messages.map((message) => message.text ?? ""));
    expect(texts.filter((text) => /https?:\/\/|www\./i.test(text))).toEqual([]);
  });
});
