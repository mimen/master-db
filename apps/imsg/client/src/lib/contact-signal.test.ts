import { describe, expect, test } from "bun:test";
import type { ChatSummary } from "@shared/types";

import {
  compactAge,
  contactSecondary,
  contactSections,
  conversationState,
  findDuplicates,
  guessFromMessage,
  handleRows,
  matchesContact,
  serviceIndex,
  recentPeopleIds,
  sharedGroupLine,
} from "./contact-order";

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

function chat(guid: string, addresses: string[], minutesAgo: number, extra: Partial<ChatSummary> = {}): ChatSummary {
  return {
    guid,
    displayName: guid,
    isGroup: guid.includes(";+;"),
    known: true,
    isSpam: false,
    participants: addresses.map((address, i) => ({ address, name: ["Marissa Lin", "Taylor Reyes", "Jordan Kim"][i] ?? null })),
    lastMessage: { guid: `${guid}-m`, text: "hi", dateCreated: NOW - minutesAgo * 60_000, isFromMe: false, senderName: null, hasAttachments: false },
    unreadCount: 0,
    flags: { unresponded: false, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
    ...extra,
  };
}

function person(_id: string, display_name: string, extra: Record<string, unknown> = {}) {
  return { _id, display_name, normalized_phones: [] as string[], normalized_emails: [] as string[], ...extra };
}

describe("serviceIndex", () => {
  test("follows the newest one-to-one thread for the handle", () => {
    const chats = [chat("iMessage;-;+15550142298", ["+15550142298"], 300), chat("SMS;-;+15550142298", ["+15550142298"], 10)];
    expect(serviceIndex(chats)("(555) 014-2298")).toBe("SMS");
  });

  test("an RCS thread is SMS, as the bubble color is", () => {
    const chats = [chat("iMessage;-;+15550142298", ["+15550142298"], 300), chat("RCS;-;+15550142298", ["+15550142298"], 10)];
    expect(serviceIndex(chats)("(555) 014-2298")).toBe("SMS");
  });

  test("with no thread a handle defaults to iMessage", () => {
    const lookup = serviceIndex([chat("SMS;-;t@x.example", ["T@x.example"], 5)]);
    expect(lookup("t@x.example")).toBe("SMS");
    expect(lookup("+15550000000")).toBe("iMessage");
    expect(lookup("nobody@x.example")).toBe("iMessage");
  });
});

describe("contactSections", () => {
  test("favorites, then recent, then A to Z, each person once", () => {
    const people = [
      person("a", "Alex Barrera"),
      person("b", "Brady Barnhart"),
      person("t", "Tracy Mesina", { is_favorite: true }),
      person("d", "Dani Okafor"),
    ];
    const rows = contactSections(people, "first-last", ["t", "b"]);
    expect(rows.map((r) => (r.kind === "section" ? `#${r.label}` : r.title))).toEqual([
      "#Favorites", "Tracy Mesina", "#Recent", "Brady Barnhart", "#A", "Alex Barrera", "#D", "Dani Okafor",
    ]);
  });
});

describe("recentPeopleIds", () => {
  test("orders people by their newest one-to-one message and skips groups", () => {
    const people = [person("a", "A", { normalized_phones: ["+15550000001"] }), person("b", "B", { normalized_phones: ["+15550000002"] })];
    const chats = [
      chat("iMessage;-;+15550000001", ["+15550000001"], 90),
      chat("iMessage;-;+15550000002", ["+15550000002"], 5),
      chat("iMessage;+;g", ["+15550000001"], 1),
    ];
    expect(recentPeopleIds(people, chats, 5)).toEqual(["b", "a"]);
  });
});

describe("matchesContact", () => {
  const tracy = { display_name: "Tracy Mesina", organization: "Night Shift Collective", normalized_phones: ["+15550142298"], normalized_emails: ["tracy@nightshift.example"] };
  test("matches names, organizations, emails and phone digits", () => {
    expect(matchesContact(tracy, "mesi")).toBe(true);
    expect(matchesContact(tracy, "night shift")).toBe(true);
    expect(matchesContact(tracy, "nightshift.ex")).toBe(true);
    expect(matchesContact(tracy, "(555) 014")).toBe(true);
    expect(matchesContact(tracy, "999")).toBe(false);
  });
});

describe("findDuplicates", () => {
  test("pairs same-name people with the busier one kept, and skips dismissed pairs", () => {
    const busy = person("1", "Dani Okafor", { message_count: 132 });
    const quiet = person("2", "dani okafor", { message_count: 9 });
    const other = person("3", "Wes Berger");
    expect(findDuplicates([quiet, busy, other])).toEqual([{ keep: busy, other: quiet }]);
    expect(findDuplicates([busy, { ...quiet, not_duplicate_of: ["1"] }])).toEqual([]);
  });
});

describe("contactSecondary", () => {
  test("prefers the organization, then the message count", () => {
    expect(contactSecondary({ organization: "AUF", message_count: 3 })).toBe("AUF");
    expect(contactSecondary({ message_count: 1284 })).toBe("1,284 messages");
    expect(contactSecondary({ message_count: 1 })).toBe("1 message");
    expect(contactSecondary({})).toBe("");
  });
});

describe("compactAge and conversationState", () => {
  test("compact ages", () => {
    expect(compactAge(NOW - 40 * 60_000, NOW)).toBe("40m");
    expect(compactAge(NOW - 5 * 3_600_000, NOW)).toBe("5h");
    expect(compactAge(NOW - 2 * 86_400_000, NOW)).toBe("2d");
    expect(compactAge(Date.UTC(2026, 8, 12, 12), NOW)).toBe("Sep 12");
  });

  test("an unanswered inbound message reads Your turn, never owed", () => {
    const waiting = chat("iMessage;-;+1", ["+1"], 300, { flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: false } });
    expect(conversationState(waiting, NOW)).toEqual({ label: "Your turn 5h", yourTurn: true });
    expect(conversationState(chat("iMessage;+;g", ["+1"], 2880), NOW)).toEqual({ label: "2d", yourTurn: false });
  });
});

describe("sharedGroupLine", () => {
  test("names the other members by first name", () => {
    const group = chat("iMessage;+;g", ["+15550000001", "+15550000002", "+15550000003"], 10);
    expect(sharedGroupLine(group, ["+15550000002"])).toBe("Shared group with Marissa and Jordan");
  });
});

describe("handleRows", () => {
  test("labels phones and emails, marks the primary and lists other networks last", () => {
    const rows = handleRows(
      { normalized_phones: ["+15550142298", "+15550187731"], normalized_emails: ["t@x.example"], primary_handle: "+15550187731" },
      [{ kind: "instagram", network: "instagram", value: "@tracy", normalized: "@tracy" }, { kind: "phone", value: "+15550142298", normalized: "+15550142298" }],
      serviceIndex([chat("SMS;-;+15550187731", ["+15550187731"], 5), chat("iMessage;-;t@x.example", ["t@x.example"], 9)]),
    );
    expect(rows.map((r) => [r.label, r.display, r.service, r.primary, r.reachable])).toEqual([
      ["phone", "(555) 014-2298", "iMessage", false, true],
      ["phone 2", "(555) 018-7731", "SMS", true, true],
      ["email", "t@x.example", "iMessage", false, true],
      ["Instagram", "@tracy", "Other", false, false],
    ]);
  });
});

describe("guessFromMessage", () => {
  test("pulls a first name and a venue, not a referrer's name", () => {
    expect(guessFromMessage("Hey! This is Rae from The Loft")).toEqual({ first: "Rae", organization: "The Loft" });
    expect(guessFromMessage("Hey! This is Rae from the venue, got your number from Tracy")).toEqual({ first: "Rae" });
    expect(guessFromMessage(undefined)).toEqual({});
  });
});

import { personSubline } from "./contact-order";

describe("personSubline", () => {
  test("joins the organization and message history", () => {
    expect(personSubline({ organization: "Night Shift Collective", message_count: 1284, created_at: "2022-03-14T12:00:00Z" }))
      .toBe("Night Shift Collective. 1,284 messages since 2022");
    expect(personSubline({ message_count: 9 })).toBe("9 messages");
    expect(personSubline({})).toBe("");
  });
});
