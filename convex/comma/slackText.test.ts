import { describe, expect, test } from "vitest";

import { slackDisplayText, slackModelText } from "./slackText";

const names = (id: string) => ({ U1: "Milad", U2: "Sam" } as Record<string, string>)[id];

describe("slackDisplayText", () => {
  test("names mentions and channels, shows link labels, decodes entities, and places each mention", () => {
    const shown = slackDisplayText("hey <@U2> see <#C1|bookings> &amp; <https://x.test/a?b=1&amp;c=2|the doc> &lt;3", names);
    expect(shown.text).toBe("hey @Sam see #bookings & the doc <3");
    expect(shown.mentions).toEqual([{ address: "slack:U2", start: 4, length: 4 }]);
  });

  test("falls back to Slack's own label, then a neutral name; specials read as Slack shows them", () => {
    expect(slackDisplayText("<@U9|dana> <@U8> <!here> <!subteam^S1|@ops> <mailto:a@b.co|a@b.co> <https://x.test>", names).text)
      .toBe("@dana @Slack user @here @ops a@b.co https://x.test");
  });
});

describe("slackModelText", () => {
  test("keeps a labelled link's URL for the model and names a thread reply's root", () => {
    expect(slackModelText(names)({ text: "<@U1> read <https://x.test|this>", ts: "2.0", thread_ts: "1.0" }))
      .toEqual({ modelText: "@Milad read this (https://x.test)", threadRef: "1.0" });
  });

  test("derives nothing when the shown text already reads cleanly, as on a thread's root", () => {
    expect(slackModelText(names)({ text: "plain <@U2>", ts: "1.0", thread_ts: "1.0" })).toEqual({});
  });
});
