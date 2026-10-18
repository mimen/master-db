import type { ChatSummary } from "@shared/types";
import { describe, expect, test } from "bun:test";

import { composeSections, looksLikeAddress } from "./compose-rows";

const dm = (address: string, name: string): ChatSummary => ({
  guid: `iMessage;-;${address}`, displayName: name, isGroup: false, known: true, isSpam: false,
  participants: [{ address, name }], lastMessage: null, unreadCount: 0,
  flags: { unresponded: false, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
});
const group: ChatSummary = { ...dm("+15550009999", "Crew"), guid: "iMessage;+;crew", isGroup: true };
const directory = [dm("+15550001111", "Alex Rivera"), group, dm("+15550002222", "Nick Chase")];
const titles = (s: ReturnType<typeof composeSections>) => s.map((x) => `${x.title}: ${x.rows.map((r) => (r.kind === "airtable" ? r.human.display_name : r.contact.name)).join(", ")}`);

describe("composeSections", () => {
  test("an empty query lists recent one-to-one people, skipping groups and anyone already added", () => {
    expect(titles(composeSections({ query: "", recipients: [{ address: "+15550002222", name: "Nick Chase" }], directory, contacts: [], airtable: [] })))
      .toEqual(["Recent: Alex Rivera"]);
  });

  test("a name with a space matches instantly from conversations, before the contact search, once per address", () => {
    const sections = composeSections({ query: "nick ch", recipients: [], directory, contacts: [{ address: "+1 (555) 000-2222", name: "Nick Chase" }, { address: "+15550003333", name: "Nick Cheng" }], airtable: [] });
    expect(titles(sections)).toEqual(["People: Nick Chase, Nick Cheng"]);
  });

  test("a sendable number or email gets its own row; a half-typed name does not", () => {
    expect(titles(composeSections({ query: "619 555 0101", recipients: [], directory, contacts: [], airtable: [] }))).toEqual(["New number: 619 555 0101"]);
    expect(composeSections({ query: "Alex R", recipients: [], directory: [], contacts: [], airtable: [] })).toEqual([]);
    expect(looksLikeAddress("a@b.co")).toBe(true);
    expect(looksLikeAddress("Alex")).toBe(false);
    expect(looksLikeAddress("555")).toBe(false);
  });
});
