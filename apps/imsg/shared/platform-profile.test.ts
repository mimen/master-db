import { describe, expect, test } from "bun:test";

import { attentionOf, composerConfig, IMESSAGE_PROFILE, platformServiceBadges, PROFILES, reactionSupport, screeningOf, support, type Feature, type ProfileRoute } from "./platform-profile";

const dm = (service: ProfileRoute["service"]): ProfileRoute => ({ platform: "imessage", service, isGroup: false });
const group = (service: ProfileRoute["service"]): ProfileRoute => ({ platform: "imessage", service, isGroup: true });
const features = Object.keys(IMESSAGE_PROFILE.features) as Feature[];

describe("support", () => {
  test("an iMessage group can do everything", () => {
    for (const feature of features) expect(support(group("iMessage"), feature)).toEqual({ ok: true });
  });

  test("SMS can't react, reply, edit, unsend, type or mention, and says so", () => {
    expect(support(dm("SMS"), "react")).toEqual({ ok: false, reason: "SMS can't send reactions" });
    expect(support(dm("SMS"), "edit")).toEqual({ ok: false, reason: "SMS can't edit messages" });
    expect(support(dm("SMS"), "unsend")).toEqual({ ok: false, reason: "SMS can't unsend messages" });
    expect(support(dm("SMS"), "reply")).toEqual({ ok: false, reason: "SMS can't reply to a message" });
    expect(support(dm("SMS"), "typing")).toEqual({ ok: false, reason: "SMS can't show typing" });
    expect(support(group("SMS"), "mentions")).toEqual({ ok: false, reason: "SMS can't mention people" });
  });

  test("RCS reacts and replies but can't edit or unsend", () => {
    expect(support(dm("RCS"), "react")).toEqual({ ok: true });
    expect(support(dm("RCS"), "reply")).toEqual({ ok: true });
    expect(support(dm("RCS"), "edit")).toEqual({ ok: false, reason: "RCS can't edit messages" });
  });

  test("SMS keeps attachments, voice, contact cards, scheduling and deleting", () => {
    for (const feature of ["attachments", "voiceMemo", "contactCard", "schedule", "deleteMessage", "deleteChat"] as const) {
      expect(support(dm("SMS"), feature)).toEqual({ ok: true });
    }
  });

  test("an SMS group can't be managed", () => {
    expect(support(group("SMS"), "rename")).toEqual({ ok: false, reason: "SMS can't name a group" });
    expect(support(group("SMS"), "participants")).toEqual({ ok: false, reason: "SMS can't add or remove people" });
    expect(support(group("SMS"), "leaveGroup")).toEqual({ ok: false, reason: "SMS can't leave a group" });
  });

  test("group features don't exist in a one-to-one conversation on any service", () => {
    for (const feature of ["rename", "participants", "leaveGroup", "mentions"] as const) {
      expect(support(dm("iMessage"), feature)).toBeNull();
      expect(support(dm("SMS"), feature)).toBeNull();
    }
  });

  test("Private API features grey out while the Mac's Private API is off; the service reason wins", () => {
    const off = { privateApi: false };
    expect(support(dm("iMessage"), "react", off)).toEqual({ ok: false, reason: "Needs the Mac's Private API" });
    expect(support(dm("iMessage"), "schedule", off)).toEqual({ ok: true });
    expect(support(dm("SMS"), "react", off)).toEqual({ ok: false, reason: "SMS can't send reactions" });
  });
});

test("the six tapbacks and emoji: keys send, and none on SMS", () => {
  expect(reactionSupport(dm("iMessage"), "love")).toEqual({ ok: true });
  expect(reactionSupport(dm("RCS"), "emoji:🫶🏽")).toEqual({ ok: true });
  expect(reactionSupport(dm("iMessage"), "emoji")).toEqual({ ok: false, reason: "iMessage can't send that reaction" });
  expect(reactionSupport(dm("iMessage"), "emoji:")).toEqual({ ok: false, reason: "iMessage can't send that reaction" });
  expect(reactionSupport(dm("iMessage"), "wave")).toEqual({ ok: false, reason: "iMessage can't send that reaction" });
  expect(reactionSupport(dm("SMS"), "love")).toEqual({ ok: false, reason: "SMS can't send reactions" });
});

test("emoji reactions need the Mac to advertise them; named tapbacks don't", () => {
  const bridge = { privateApi: true, emojiReactions: false };
  expect(reactionSupport(dm("iMessage"), "emoji:😍", bridge)).toEqual({ ok: false, reason: "The Mac's BlueBubbles can't send emoji reactions yet" });
  expect(reactionSupport(dm("iMessage"), "love", bridge)).toEqual({ ok: true });
  expect(support(dm("SMS"), "emojiReact", bridge)).toEqual({ ok: false, reason: "SMS can't send emoji reactions" });
  expect(support(dm("iMessage"), "emojiReact", { privateApi: true, emojiReactions: true })).toEqual({ ok: true });
});

describe("composerConfig", () => {
  const labels = (route: ProfileRoute) => composerConfig(route).serviceOptions.map((option) => option.label);

  test("an iMessage conversation sends blue as iMessage, with SMS listed second", () => {
    expect(composerConfig(dm("iMessage"))).toMatchObject({ placeholder: "iMessage", badge: { label: "iMessage", color: "accent" }, enterSends: true, editWindowMs: 15 * 60_000 });
    expect(labels(dm("iMessage"))).toEqual(["iMessage", "SMS"]);
  });

  test("SMS and RCS send green as Text Message, with iMessage listed second", () => {
    for (const service of ["SMS", "RCS"] as const) {
      expect(composerConfig(dm(service))).toMatchObject({ placeholder: "Text Message", badge: { label: "SMS", color: "sms" } });
      expect(labels(dm(service))).toEqual(["SMS", "iMessage"]);
    }
  });
});

test("iMessage's filterable services are iMessage and SMS, RCS reading as SMS", () => {
  expect(platformServiceBadges("imessage").map((badge) => badge.label)).toEqual(["iMessage", "SMS"]);
});

describe("iMessage's attention and screening", () => {
  test("an inbound last message needs you and an outbound one waits, in a dm or a group", () => {
    for (const kind of ["dm", "group"] as const) {
      expect(attentionOf({ platform: "imessage", kind }, { isFromMe: false })).toBe("needsYou");
      expect(attentionOf({ platform: "imessage", kind }, { isFromMe: true })).toBe("waiting");
      expect(attentionOf({ platform: "imessage", kind }, null)).toBe("none");
    }
  });

  test("junk screens before names do, and a named participant makes the conversation known", () => {
    expect(screeningOf({ platform: "imessage", isSpam: true, known: true })).toBe("spam");
    expect(screeningOf({ platform: "imessage", isSpam: false, known: true })).toBe("known");
    expect(screeningOf({ platform: "imessage", isSpam: false, known: false })).toBe("stranger");
  });
});

describe("Slack", () => {
  const slack = (kind: "dm" | "group" | "channel" | "thread", following?: boolean) => ({ platform: "slack" as const, kind, following });
  const route = (isGroup: boolean): ProfileRoute => ({ platform: "slack", service: "Slack", isGroup });

  test("a channel needs the user only when someone else's last message mentions them, and never waits", () => {
    expect(attentionOf(slack("channel"), { isFromMe: false })).toBe("none");
    expect(attentionOf(slack("channel"), { isFromMe: false, mentionsMe: true })).toBe("needsYou");
    expect(attentionOf(slack("channel"), { isFromMe: true, mentionsMe: true })).toBe("none");
    expect(attentionOf(slack("channel"), null)).toBe("none");
  });

  test("a dm, group dm or a thread the user follows follows iMessage's rule", () => {
    for (const conversation of [slack("dm"), slack("group"), slack("thread"), slack("thread", true)]) {
      expect(attentionOf(conversation, { isFromMe: false })).toBe("needsYou");
      expect(attentionOf(conversation, { isFromMe: true })).toBe("waiting");
    }
  });

  test("a thread the user doesn't follow wants nothing", () => {
    expect(attentionOf(slack("thread", false), { isFromMe: false })).toBe("none");
    expect(attentionOf(slack("thread", false), { isFromMe: false, mentionsMe: true })).toBe("none");
  });

  test("no Slack conversation is screened", () => {
    expect(screeningOf({ platform: "slack", isSpam: false, known: false })).toBe("known");
  });

  test("send, reply, react, edit, delete and scheduling run; what Comma does not run yet greys; what Slack lacks says so; group controls are absent", () => {
    for (const feature of ["send", "reply", "react", "emojiReact", "edit", "unsend", "schedule"] as const) expect(support(route(true), feature)).toEqual({ ok: true });
    expect(support(route(true), "attachments")).toEqual({ ok: false, reason: "Not in Comma's Slack yet" });
    expect(support(route(true), "deleteMessage")).toEqual({ ok: false, reason: "Slack can't delete a message just for you" });
    expect(support(route(false), "call")).toEqual({ ok: false, reason: "Slack can't call" });
    expect(support(route(false), "rename")).toBeNull();
    expect(reactionSupport(route(false), "emoji:🔥")).toEqual({ ok: true });
    expect(reactionSupport(route(false), "love")).toEqual({ ok: false, reason: "Slack can't send that reaction" });
  });

  test("a sender keeps many reactions, and the tray offers emoji only", () => {
    expect(PROFILES.slack.oneReactionPerSender).toBe(false);
    expect(PROFILES.slack.reactions.every((key) => key.startsWith("emoji:"))).toBe(true);
    expect(PROFILES.slack.unsendLabel).toBe("Delete");
  });

  test("the composer names the conversation, draws Slack's badge with nothing to switch to, and Enter sends", () => {
    expect(composerConfig({ platform: "slack", service: "Slack" }, "#bookings")).toMatchObject({
      placeholder: "Message #bookings", enterSends: true, badge: { label: "Slack" }, serviceOptions: [{ label: "Slack" }],
    });
    expect(composerConfig({ platform: "imessage", service: "iMessage" }, "Alex").placeholder).toBe("iMessage");
  });

  test("iMessage still sends text on every service", () => {
    for (const service of ["iMessage", "SMS", "RCS"] as const) expect(support(dm(service), "send")).toEqual({ ok: true });
  });
});

describe("Gmail", () => {
  const thread = { platform: "gmail" as const, kind: "emailThread" as const };
  const route: ProfileRoute = { platform: "gmail", service: "Gmail", isGroup: true };

  test("an inbound last email needs you and an outbound one waits", () => {
    expect(attentionOf(thread, { isFromMe: false })).toBe("needsYou");
    expect(attentionOf(thread, { isFromMe: true })).toBe("waiting");
  });

  test("bulk mail is its own verdict, ahead of a known sender; other mail screens like iMessage", () => {
    expect(screeningOf({ platform: "gmail", isSpam: false, known: true, bulk: true })).toBe("bulk");
    expect(screeningOf({ platform: "gmail", isSpam: false, known: true })).toBe("known");
    expect(screeningOf({ platform: "gmail", isSpam: false, known: false })).toBe("stranger");
    expect(screeningOf({ platform: "imessage", isSpam: false, known: true, bulk: true })).toBe("known");
  });

  test("sends, replies and schedules; attachments grey with their reason, and what Gmail lacks says so", () => {
    for (const feature of ["send", "reply", "schedule"] as const) expect(support(route, feature)).toEqual({ ok: true });
    expect(support(route, "attachments")).toEqual({ ok: false, reason: "Not in Comma's Gmail yet" });
    expect(support(route, "react")).toEqual({ ok: false, reason: "Gmail can't send reactions" });
    expect(support(route, "edit")).toEqual({ ok: false, reason: "Gmail can't edit messages" });
    expect(reactionSupport(route, "emoji:🔥")).toEqual({ ok: false, reason: "Gmail can't send emoji reactions" });
  });

  test("the composer draws Gmail's badge and Enter adds a line", () => {
    expect(composerConfig({ platform: "gmail", service: "Gmail" })).toMatchObject({ placeholder: "Reply", enterSends: false, badge: { label: "Gmail" } });
  });
});
