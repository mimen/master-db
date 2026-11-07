import { expect, test } from "bun:test";

import { fixtureChatGuid, fixtureConversationId } from "./fixture-ids";

test("a fixture conversation id round-trips to its chat GUID and is not one", () => {
  for (const guid of ["iMessage;-;+15550001111", "SMS;+;chat123", "iMessage;-;a@b.co"]) {
    const id = fixtureConversationId(guid);
    expect(id).not.toContain(";");
    expect(fixtureChatGuid(id)).toBe(guid);
  }
  expect(fixtureChatGuid("iMessage;-;+15550001111")).toBe("not-a-conversation:iMessage;-;+15550001111");
});
