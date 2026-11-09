import { describe, expect, test } from "vitest";

import { resolveConversationNames } from "./names";

const alex = { display_name: "Alex Rivera", first_name: "Alex", last_name: "Rivera", nickname: "Lex" };
const sam = { display_name: "Sam Chen", organization: "AUF" };

describe("resolveConversationNames", () => {
  test("a DM takes its person's current name and every name they go by", () => {
    const names = resolveConversationNames({ isGroup: false, displayName: "Stale", participants: [{ address: "+16195550101", name: "Stale" }] }, [alex]);
    expect(names).toEqual({
      displayName: "Alex Rivera",
      participants: [{ address: "+16195550101", name: "Alex Rivera" }],
      known: true,
      searchNames: ["alex rivera", "alex", "rivera", "lex"],
    });
  });

  test("a handle without a named person is unknown and shown by its formatted address", () => {
    const names = resolveConversationNames({ isGroup: false, displayName: "Stale", participants: [{ address: "+16195550999", name: "Stale" }] },
      [{ first_name: "Nameless" }]);
    expect(names).toEqual({ displayName: "(619) 555-0999", participants: [{ address: "+16195550999", name: null }], known: false, searchNames: [] });
  });

  test("a named group keeps the chat's own name; an unnamed one lists its members", () => {
    const participants = [{ address: "+16195550101", name: null }, { address: "+16195550999", name: null }];
    expect(resolveConversationNames({ isGroup: true, displayName: "x", rawDisplayName: " Launch Crew ", participants }, [alex, null]).displayName)
      .toBe("Launch Crew");
    const unnamed = resolveConversationNames({ isGroup: true, displayName: "x", rawDisplayName: "", participants }, [alex, null]);
    expect(unnamed).toMatchObject({ displayName: "Alex Rivera, (619) 555-0999", known: true });
  });

  test("the user's own Slack DM reads as You, not as Slack", () => {
    expect(resolveConversationNames({ platform: "slack", isGroup: false, displayName: "Slack", participants: [] }, []).displayName).toBe("You");
    expect(resolveConversationNames({ platform: "imessage", isGroup: false, displayName: "Stored", participants: [] }, []).displayName).toBe("Stored");
  });

  test("a group stored before rawDisplayName existed keeps its stored name", () => {
    const participants = [{ address: "+16195550101", name: null }, { address: "+16195550103", name: null }];
    const names = resolveConversationNames({ isGroup: true, displayName: "Old Title", participants }, [alex, sam]);
    expect(names.displayName).toBe("Old Title");
    expect(names.searchNames).toEqual(["alex rivera", "alex", "rivera", "lex", "sam chen", "auf"]);
  });
});
