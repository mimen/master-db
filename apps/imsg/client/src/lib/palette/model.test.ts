import { describe, expect, test } from "bun:test";

import type { ChatSummary, Contact, Message } from "@shared/types";

import { buildPaletteSections, flattenSections, matchScore, PALETTE_COMMANDS } from "./model";

const chat = (over: Partial<ChatSummary>): ChatSummary => ({
  guid: over.guid ?? "g",
  displayName: over.displayName ?? "Someone",
  isGroup: false,
  known: true,
  isSpam: false,
  participants: [],
  lastMessage: null,
  unreadCount: 0,
  flags: {
    archived: false,
    unresponded: false,
    waiting: false,
    unread: false,
    mutedUnresponded: false,
    pinned: false,
  },
  ...over,
});

const msg = (guid: string, text: string): Message =>
  ({ guid, chatGuid: "c", text, dateCreated: 1, isFromMe: false }) as unknown as Message;

const contact = (name: string, address: string): Contact => ({ name, address });

describe("matchScore", () => {
  test("exact > word-prefix > substring > miss", () => {
    expect(matchScore("tyson", "Tyson")).toBe(3);
    expect(matchScore("tys", "Tyson Guy")).toBe(2);
    expect(matchScore("guy", "Tyson Guy")).toBe(2);
    expect(matchScore("yso", "Tyson")).toBe(1);
    expect(matchScore("zzz", "Tyson")).toBe(0);
  });
});

describe("buildPaletteSections", () => {
  const tysonDm = chat({ guid: "dm", displayName: "Tyson", participants: [{ address: "+1555", name: "Tyson" }] });
  const tysonGroup = chat({
    guid: "grp",
    displayName: "Umbrella Weekend",
    isGroup: true,
    participants: [
      { address: "+1555", name: "Tyson" },
      { address: "+1666", name: "Wes" },
    ],
  });
  const namedGroup = chat({ guid: "grp2", displayName: "Tyson Planning", isGroup: true, participants: [] });
  const other = chat({ guid: "other", displayName: "Karely" });

  test("blank query lists every command then recent non-archived chats", () => {
    const archived = chat({ guid: "arch", displayName: "Old", flags: { ...tysonDm.flags, archived: true } });
    const sections = buildPaletteSections({
      query: "  ",
      chats: [tysonDm, archived, other],
      messages: [],
      contacts: [],
    });

    expect(sections[0]?.title).toBe("Commands");
    expect(sections[0]?.items.length).toBe(PALETTE_COMMANDS.length);
    expect(sections[1]?.title).toBe("Recent");
    expect(sections[1]?.items.map((i) => (i.kind === "conversation" ? i.chat.guid : "?"))).toEqual([
      "dm",
      "other",
    ]);
  });

  test("approved section order: commands, conversations, groups, messages, contacts", () => {
    const sections = buildPaletteSections({
      query: "tyson",
      chats: [other, tysonDm, tysonGroup, namedGroup],
      messages: [msg("m1", "tyson said hi")],
      contacts: [contact("Tyson", "+1555")],
    });

    expect(sections.map((s) => s.title)).toEqual(["Conversations", "Groups", "Messages", "Contacts"]);
    const flat = flattenSections(sections);
    expect(flat[0]).toMatchObject({ kind: "conversation", chat: { guid: "dm" } });
  });

  test("group name hits outrank member hits; member hit carries the matched name", () => {
    const sections = buildPaletteSections({
      query: "tyson",
      chats: [tysonGroup, namedGroup],
      messages: [],
      contacts: [],
    });
    const groups = sections.find((s) => s.title === "Groups")!.items;

    expect(groups[0]).toMatchObject({ kind: "group", chat: { guid: "grp2" }, matchedMember: null });
    expect(groups[1]).toMatchObject({ kind: "group", chat: { guid: "grp" }, matchedMember: "Tyson" });
  });

  test("commands appear only when matched, and match keywords", () => {
    const none = buildPaletteSections({ query: "tyson", chats: [], messages: [], contacts: [] });
    expect(none.find((s) => s.title === "Commands")).toBeUndefined();

    const unre = buildPaletteSections({ query: "unre", chats: [], messages: [], contacts: [] });
    const titles = unre
      .find((s) => s.title === "Commands")!
      .items.map((i) => (i.kind === "command" ? i.command.title : "?"));
    expect(titles).toEqual(["Unread", "Unresponded"]);

    const help = buildPaletteSections({ query: "help", chats: [], messages: [], contacts: [] });
    expect(
      help.find((s) => s.title === "Commands")!.items.some(
        (i) => i.kind === "command" && i.command.title === "Keyboard Shortcuts",
      ),
    ).toBe(true);
  });

  test("archived chats are searchable (search spans everything)", () => {
    const archived = chat({
      guid: "arch",
      displayName: "Tyson Old",
      flags: { ...tysonDm.flags, archived: true },
    });
    const sections = buildPaletteSections({ query: "tyson", chats: [archived], messages: [], contacts: [] });

    expect(sections.find((s) => s.title === "Conversations")?.items.length).toBe(1);
  });

  test("a renamed DM surfaces via searchNames when neither displayName nor participant.name match", () => {
    // The Jimmy Sciandra scenario: renamed in-app to "Uncle Jimmy", but the
    // Identity Mirror's full term list (populated onto the chat's
    // searchNames by map.ts) still carries the old first/last name.
    const renamed = chat({
      guid: "jimmy",
      displayName: "Uncle Jimmy",
      participants: [{ address: "+16266522285", name: "Uncle Jimmy" }],
      searchNames: ["uncle jimmy", "jimmy", "sciandra", "jimmy sciandra"],
    });
    const sections = buildPaletteSections({
      query: "sciandra",
      chats: [renamed],
      messages: [],
      contacts: [],
    });

    const conversations = sections.find((s) => s.title === "Conversations")?.items ?? [];
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({ kind: "conversation", chat: { guid: "jimmy" } });
  });

  test("a renamed group surfaces via searchNames when the group name doesn't match", () => {
    const renamedGroup = chat({
      guid: "jimmy-grp",
      displayName: "Family Chat",
      isGroup: true,
      participants: [{ address: "+16266522285", name: "Uncle Jimmy" }],
      searchNames: ["uncle jimmy", "jimmy", "sciandra", "jimmy sciandra"],
    });
    const sections = buildPaletteSections({
      query: "sciandra",
      chats: [renamedGroup],
      messages: [],
      contacts: [],
    });

    const groups = sections.find((s) => s.title === "Groups")?.items ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "group", chat: { guid: "jimmy-grp" } });
  });

  test("no searchNames on a chat doesn't throw and doesn't spuriously match", () => {
    const sections = buildPaletteSections({ query: "sciandra", chats: [tysonDm], messages: [], contacts: [] });
    expect(sections.find((s) => s.title === "Conversations")).toBeUndefined();
  });
});
