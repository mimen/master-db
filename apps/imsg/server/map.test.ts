import { describe, expect, test } from "bun:test";
import type { BBMessage } from "./bb-types";
import { FakeBlueBubbles } from "./bluebubbles-fake";
import { ContactBook } from "./contacts";
import { buildThread } from "./map";

const CHAT_GUID = "iMessage;-;+15550001111";

async function contacts(): Promise<ContactBook> {
  const book = new ContactBook(new FakeBlueBubbles({ chats: [], contacts: [] }));
  await book.refresh(true);
  return book;
}

describe("buildThread reactions", () => {
  test("folds an incoming emoji reaction into its target message", async () => {
    const target: BBMessage = {
      guid: "target",
      text: "I think so anyways",
      dateCreated: 1_000,
      isFromMe: true,
    };
    const reaction: BBMessage = {
      guid: "reaction",
      text: "​❤️​ to “ I think so anyways ”",
      dateCreated: 2_000,
      isFromMe: false,
      associatedMessageGuid: "target",
      associatedMessageType: "2006",
      handle: { address: "+15550001111" },
    };

    const messages = buildThread([reaction, target], CHAT_GUID, await contacts());

    expect(messages).toHaveLength(1);
    expect(messages[0]?.guid).toBe("target");
    expect(messages[0]?.reactions).toEqual([
      {
        type: "❤️",
        isFromMe: false,
        senderName: null,
        senderAddress: "+15550001111",
      },
    ]);
  });

  test("loads reactions directly for an older target message", async () => {
    const target: BBMessage = {
      guid: "old-target",
      text: "An older message",
      dateCreated: 1_000,
      isFromMe: true,
    };
    const intervening: BBMessage[] = Array.from({ length: 45 }, (_, index) => ({
      guid: `later-${index}`,
      text: `Later message ${index}`,
      dateCreated: 2_000 + index,
      isFromMe: index % 2 === 0,
    }));
    const reaction: BBMessage = {
      guid: "late-reaction",
      text: "​👍​ to “ An older message ”",
      dateCreated: 3_000,
      isFromMe: false,
      associatedMessageGuid: "p:2/old-target",
      associatedMessageType: "2006",
      handle: { address: "+15550001111" },
    };
    const bb = new FakeBlueBubbles({
      chats: [{ guid: CHAT_GUID, messages: [target, ...intervening, reaction] }],
      contacts: [],
    });
    const book = new ContactBook(bb);
    await book.refresh(true);

    const result = await bb.messageWithReactions(target.guid);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildThread(result.value, CHAT_GUID, book)[0]?.reactions[0]?.type).toBe("👍");
  });
});
