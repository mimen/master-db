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

  // -------------------------------------------------------- favorite ranking

  describe("favorite ranking", () => {
    test("a favorited DM wins a same-tier tie over a non-favorite (substring match)", () => {
      // "arissa" is a mid-string substring (score 1) for both — same tier.
      const favorite = chat({ guid: "fav", displayName: "Marissa Carlene", crm: { is_favorite: true } });
      const plain = chat({ guid: "plain", displayName: "Klarissa" });
      const sections = buildPaletteSections({ query: "arissa", chats: [plain, favorite], messages: [], contacts: [] });

      const conversations = sections.find((s) => s.title === "Conversations")!.items;
      expect(conversations.map((i) => (i.kind === "conversation" ? i.chat.guid : "?"))).toEqual(["fav", "plain"]);
    });

    test("a strong non-favorite match still beats a weak favorite match", () => {
      // "ma" is an exact word-prefix (score 2) for "Marissa" but only a
      // substring (score 1) for the favorited "Emma" — the favorite bonus
      // (0.5) must not close a full match-tier gap.
      const strongMatch = chat({ guid: "marissa", displayName: "Marissa" });
      const weakFavorite = chat({ guid: "emma", displayName: "Emma", crm: { is_favorite: true } });
      const sections = buildPaletteSections({
        query: "ma",
        chats: [weakFavorite, strongMatch],
        messages: [],
        contacts: [],
      });

      const conversations = sections.find((s) => s.title === "Conversations")!.items;
      expect(conversations.map((i) => (i.kind === "conversation" ? i.chat.guid : "?"))).toEqual(["marissa", "emma"]);
    });

    test("a favorite with zero match is never conjured into the results", () => {
      const favoriteNoMatch = chat({ guid: "fav", displayName: "Nobody Related", crm: { is_favorite: true } });
      const sections = buildPaletteSections({
        query: "zzz-nomatch",
        chats: [favoriteNoMatch],
        messages: [],
        contacts: [],
      });

      expect(sections.find((s) => s.title === "Conversations")).toBeUndefined();
    });

    test("a favorited group wins a same-tier tie over a non-favorite group", () => {
      // Both hit an identical exact member-name match ("Tyson", score 3) and
      // neither group name matches — a genuine tie except for favorite status.
      const favGroup = chat({
        guid: "fav-grp",
        displayName: "Umbrella Weekend",
        isGroup: true,
        participants: [{ address: "+1555", name: "Tyson" }],
        crm: { is_favorite: true },
      });
      const plainGroup = chat({
        guid: "plain-grp",
        displayName: "Other Group",
        isGroup: true,
        participants: [{ address: "+1666", name: "Tyson" }],
      });
      const sections = buildPaletteSections({
        query: "tyson",
        chats: [plainGroup, favGroup],
        messages: [],
        contacts: [],
      });

      const groups = sections.find((s) => s.title === "Groups")!.items;
      expect(groups.map((i) => (i.kind === "group" ? i.chat.guid : "?"))).toEqual(["fav-grp", "plain-grp"]);
    });

    test("a favorited contact sorts before a non-favorite contact, preserving server order otherwise", () => {
      const sections = buildPaletteSections({
        query: "ma",
        chats: [],
        messages: [],
        contacts: [
          contact("Mateo", "+1111"),
          { ...contact("Marissa", "+1222"), is_favorite: true },
          contact("Maya", "+1333"),
        ],
      });

      const contacts = sections.find((s) => s.title === "Contacts")!.items;
      expect(contacts.map((i) => (i.kind === "contact" ? i.contact.name : "?"))).toEqual([
        "Marissa",
        "Mateo",
        "Maya",
      ]);
    });
  });
});
