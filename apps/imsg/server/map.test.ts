import { describe, expect, test } from "bun:test";
import type { BBAttachment, BBChat, BBMessage } from "./bb-types";
import { buildThread, mapChat, mapMessage, tapbackReactionEvent, visibleAttachments } from "./map";
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


describe("message service mapping", () => {
  const source = fakeNameSource({});

  test("keeps an SMS sibling message green under an iMessage canonical chat", () => {
    const message = mapMessage({
      guid: "sms-1",
      text: "green",
      isFromMe: true,
      chats: [{ guid: "SMS;-;+15550001111" }],
    }, "iMessage;-;+15550001111", source);
    expect(message.chatGuid).toBe("iMessage;-;+15550001111");
    expect(message.service).toBe("SMS");
  });

  test("an unsent message reads as retracted: BlueBubbles reports it as an edit to no text", () => {
    const unsent = mapMessage({ guid: "u-1", text: null, isFromMe: true, dateEdited: 1791118569379 } as never, "iMessage;-;+15550001111", source);
    expect(unsent.retracted).toBe(true);
    const edited = mapMessage({ guid: "e-1", text: "still here", isFromMe: true, dateEdited: 1791118563158 } as never, "iMessage;-;+15550001111", source);
    expect(edited.retracted).toBe(false);
    const attachmentOnly = mapMessage({ guid: "a-1", text: null, isFromMe: true, attachments: [{ guid: "att", mimeType: "image/png" }] } as never, "iMessage;-;+15550001111", source);
    expect(attachmentOnly.retracted).toBe(false);
  });

  test("keeps an iMessage sibling blue under an SMS canonical chat", () => {
    const message = mapMessage({
      guid: "imessage-1",
      text: "blue",
      isFromMe: true,
    }, "SMS;-;+15550001111", source, [], "iMessage;-;+15550001111");
    expect(message.chatGuid).toBe("SMS;-;+15550001111");
    expect(message.service).toBe("iMessage");
  });
});

describe("inbound mention metadata", () => {
  test("maps BlueBubbles attributed-body mention runs onto message text", () => {
    const source = fakeNameSource({});
    const message = mapMessage(
      {
        guid: "m-mention",
        text: "Hi Alex",
        isFromMe: false,
        handle: { address: "+15550002222", service: "iMessage" },
        attributedBody: [
          {
            string: "Hi Alex",
            runs: [
              {
                range: [3, 4],
                attributes: {
                  __kIMMessagePartAttributeName: 0,
                  __kIMMentionConfirmedMention: "+15550001111",
                },
              },
            ],
          },
        ],
      },
      "iMessage;+;group",
      source,
    );
    expect(message.mentions).toEqual([{ start: 3, length: 4, address: "+15550001111" }]);
  });

  test("accepts the object-shaped attributed body returned by private-API sends", () => {
    const message = mapMessage(
      {
        guid: "m-object-mention",
        text: "Hi Alex",
        isFromMe: true,
        attributedBody: {
          string: "Hi Alex",
          runs: [
            {
              range: [3, 4],
              attributes: {
                __kIMMessagePartAttributeName: 0,
                __kIMMentionConfirmedMention: "+15550001111",
              },
            },
          ],
        },
      },
      "iMessage;+;group",
      fakeNameSource({}),
    );
    expect(message.mentions).toEqual([{ start: 3, length: 4, address: "+15550001111" }]);
  });
});

describe("duplicate attachments", () => {
  const guids = (attachments: BBAttachment[]) => visibleAttachments(attachments).map((a) => a.guid);

  test("shows the JPEG rendition instead of its HEIC original", () => {
    expect(guids([
      { guid: "at_1", transferName: "8121__F647.HEIC.jpeg", mimeType: "image/jpeg", transferState: 5, width: 750 },
      { guid: "at_0", transferName: "8121__F647.HEIC", mimeType: "image/heic", transferState: 0, width: 0 },
    ])).toEqual(["at_1"]);
  });

  test("keeps one photo even after the HEIC original is pulled to disk", () => {
    expect(guids([
      { guid: "at_1", transferName: "IMG_1.HEIC.jpeg", mimeType: "image/jpeg", transferState: 5, width: 750 },
      { guid: "at_0", transferName: "IMG_1.HEIC.jpeg", mimeType: "image/jpeg", transferState: 5, width: 3024 },
    ])).toEqual(["at_0"]);
  });

  test("drops an RCS copy that never downloaded beside the one that did", () => {
    expect(guids([
      { guid: "at_0", transferName: "1729.png", mimeType: "image/png", transferState: 5, totalBytes: 10 },
      { guid: "at_1", transferName: "1729.png", mimeType: "image/png", transferState: 0, totalBytes: 10 },
    ])).toEqual(["at_0"]);
  });

  test("keeps distinct images that share a name", () => {
    expect(guids([
      { guid: "a", transferName: "png image.png", mimeType: "image/png", transferState: 5, totalBytes: 1 },
      { guid: "b", transferName: "png image.png", mimeType: "image/png", transferState: 5, totalBytes: 2 },
      { guid: "c", transferName: "other.png", mimeType: "image/png", transferState: 0 },
    ])).toEqual(["a", "b", "c"]);
  });

  test("maps the deduped list onto the message", () => {
    const message = mapMessage({
      guid: "m",
      text: "",
      isFromMe: true,
      attachments: [
        { guid: "at_1", transferName: "x.HEIC.jpeg", mimeType: "image/jpeg", transferState: 5, width: 750, height: 1000 },
        { guid: "at_0", transferName: "x.HEIC", mimeType: "image/heic", transferState: 0 },
      ],
    }, "iMessage;-;+15550001111", fakeNameSource({}));
    expect(message.attachments).toEqual([
      { guid: "at_1", mimeType: "image/jpeg", filename: "x.HEIC.jpeg", width: 750, height: 1000, totalBytes: null },
    ]);
  });
});

describe("custom-emoji tapbacks", () => {
  const chat = "iMessage;-;+16195550101";
  const names = fakeNameSource({ names: { "+16195550101": "Marla" } });
  const target: BBMessage = {
    guid: "7C5B4020-A903-489B-8C04-611B0CCB5A06",
    text: "Hahaha",
    dateCreated: 1000,
    isFromMe: false,
    handle: { address: "+16195550101" },
  };
  function emojiTapback(extra: Partial<BBMessage>): BBMessage {
    return {
      guid: "R1",
      text: "Reacted 😍 to “Hahaha”",
      dateCreated: 2000,
      isFromMe: false,
      handle: { address: "+16195550101" },
      associatedMessageGuid: "p:0/7C5B4020-A903-489B-8C04-611B0CCB5A06",
      associatedMessageType: "2006",
      ...extra,
    };
  }

  test("reload attaches a 2006 to its target with the parsed emoji", () => {
    const thread = buildThread([emojiTapback({}), target], chat, names);
    expect(thread.map((m) => m.guid)).toEqual([target.guid]);
    expect(thread[0]?.reactions).toEqual([
      { type: "emoji", emoji: "😍", isFromMe: false, senderName: "Marla", senderAddress: "+16195550101" },
    ]);
  });

  test("reload drops a 2006 once the same sender's 3006 removes it", () => {
    const add = emojiTapback({ text: "Reacted ❤️ to “Hahaha”", isFromMe: true, handle: null });
    const remove = emojiTapback({
      guid: "R2",
      text: "Removed ❤️ from “Hahaha”",
      dateCreated: 3000,
      isFromMe: true,
      handle: null,
      associatedMessageType: "3006",
    });
    expect(buildThread([remove, add, target], chat, names)[0]?.reactions).toEqual([]);
  });

  test("a 3006 for a different emoji leaves the other reaction attached", () => {
    const add = emojiTapback({});
    const remove = emojiTapback({ guid: "R2", text: "Removed 👍 from “Hahaha”", dateCreated: 3000, associatedMessageType: "3006" });
    expect(buildThread([remove, add, target], chat, names)[0]?.reactions.map((r) => r.emoji)).toEqual(["😍"]);
  });

  test("reads the emoji from the localized and hair-space text forms, ignoring emoji in the quote", () => {
    const spanish = tapbackReactionEvent(emojiTapback({ text: "Reaccionó con 🥩 a “Bueno 😂”" }), names);
    const spaced = tapbackReactionEvent(emojiTapback({ text: " ​👍​ to “ fun 😭 ” " }), names);
    expect(spanish?.reaction.emoji).toBe("🥩");
    expect(spaced?.reaction.emoji).toBe("👍");
  });

  test("falls back to the attributed body when BlueBubbles sends no text", () => {
    const event = tapbackReactionEvent(
      emojiTapback({ text: null, attributedBody: [{ string: "Reacted 🫶🏽 to “Hahaha”", runs: [] }] }),
      names,
    );
    expect(event?.reaction.emoji).toBe("🫶🏽");
  });

  test("an unparseable 2006 still becomes a generic emoji reaction, not a bubble", () => {
    const event = tapbackReactionEvent(emojiTapback({ text: "" }), names);
    expect(event).toEqual({
      targetGuid: target.guid,
      remove: false,
      reaction: { type: "emoji", isFromMe: false, senderName: "Marla", senderAddress: "+16195550101" },
    });
    expect(buildThread([emojiTapback({ text: "" }), target], chat, names).map((m) => m.guid)).toEqual([target.guid]);
  });

  test("the chat-list preview names the emoji instead of a removal", () => {
    expect(mapMessage(emojiTapback({}), chat, names).text).toBe("Reacted 😍 to a message");
  });
});
