import { describe, expect, test } from "bun:test";
import type { BBChat } from "./bb-types";
import { mapChat } from "./map";
import type { CrmData, NameSource } from "./name-resolver";

/**
 * Covers mapChat's CRM inheritance rule (see map.ts's chatCrmField/
 * normalizeCrm docstrings and shared/types.ts's ChatSummary.crm): a GROUP
 * chat uses its OWN chat_crm; a DM has none of its own and INHERITS its one
 * participant's person CRM; neither set collapses to `undefined` either way,
 * so client code only ever needs "is there a `crm` object."
 */
function fakeNameSource(opts: {
  names?: Record<string, string>;
  chatCrm?: Record<string, CrmData>;
  personCrm?: Record<string, CrmData>;
}): NameSource {
  return {
    lookup: (address: string) => opts.names?.[address] ?? null,
    searchTerms: () => [],
    available: true,
    chatCrm: (chatGuid: string) => opts.chatCrm?.[chatGuid],
    personCrm: (address: string) => opts.personCrm?.[address],
  };
}

function dmChat(guid: string, address: string): BBChat {
  return {
    guid,
    participants: [{ address }],
    lastMessage: { guid: "m1", text: "hi", dateCreated: 1000, isFromMe: false, handle: { address } },
  };
}

function groupChat(guid: string, addresses: string[]): BBChat {
  return {
    guid,
    participants: addresses.map((address) => ({ address })),
    lastMessage: { guid: "m1", text: "hi", dateCreated: 1000, isFromMe: false, handle: { address: addresses[0] } },
  };
}

describe("mapChat CRM inheritance", () => {
  test("a GROUP chat uses its OWN chat_crm, ignoring any participant's person CRM", () => {
    const guid = "RCS;+;group-1";
    const contacts = fakeNameSource({
      chatCrm: { [guid]: { is_favorite: true, priority: 2, tags: ["planning"] } },
      personCrm: { "+15550001111": { is_favorite: false, priority: 5, tags: ["should-not-show"] } },
    });
    const summary = mapChat(groupChat(guid, ["+15550001111", "+15550002222"]), undefined, contacts);
    expect(summary.isGroup).toBe(true);
    expect(summary.crm).toEqual({ is_favorite: true, priority: 2, tags: ["planning"] });
  });

  test("a DM has no chat_crm of its own — it INHERITS its one participant's person CRM", () => {
    const guid = "iMessage;-;+15550001111";
    const contacts = fakeNameSource({
      chatCrm: { [guid]: { is_favorite: false, tags: ["should-not-show"] } }, // shouldn't happen, but prove it's ignored for DMs too
      personCrm: { "+15550001111": { is_favorite: true, priority: 1, tags: ["vip"] } },
    });
    const summary = mapChat(dmChat(guid, "+15550001111"), undefined, contacts);
    expect(summary.isGroup).toBe(false);
    expect(summary.crm).toEqual({ is_favorite: true, priority: 1, tags: ["vip"] });
  });

  test("a DM whose person has no CRM data resolves to undefined, not an empty object", () => {
    const guid = "iMessage;-;+15550001111";
    const contacts = fakeNameSource({ personCrm: { "+15550001111": {} } });
    const summary = mapChat(dmChat(guid, "+15550001111"), undefined, contacts);
    expect(summary.crm).toBeUndefined();
  });

  test("a DM whose address the mirror never resolved at all is undefined", () => {
    const guid = "iMessage;-;+15550009999";
    const contacts = fakeNameSource({});
    const summary = mapChat(dmChat(guid, "+15550009999"), undefined, contacts);
    expect(summary.crm).toBeUndefined();
  });

  test("a GROUP chat with no chat_crm data is undefined, even if a participant has person CRM", () => {
    const guid = "RCS;+;group-2";
    const contacts = fakeNameSource({
      personCrm: { "+15550001111": { is_favorite: true, priority: 1 } },
    });
    const summary = mapChat(groupChat(guid, ["+15550001111", "+15550002222"]), undefined, contacts);
    expect(summary.crm).toBeUndefined();
  });

  test("a chat_crm/personCrm entry with only empty arrays for tags/events still collapses to undefined", () => {
    const guid = "iMessage;-;+15550001111";
    const contacts = fakeNameSource({ personCrm: { "+15550001111": { tags: [], events: [] } } });
    const summary = mapChat(dmChat(guid, "+15550001111"), undefined, contacts);
    expect(summary.crm).toBeUndefined();
  });

  test("a partial CRM (only priority set) still surfaces, dropping empty tags/events", () => {
    const guid = "RCS;+;group-3";
    const contacts = fakeNameSource({ chatCrm: { [guid]: { priority: 3, tags: [] } } });
    const summary = mapChat(groupChat(guid, ["+15550001111", "+15550002222"]), undefined, contacts);
    expect(summary.crm).toEqual({ priority: 3 });
  });
});
