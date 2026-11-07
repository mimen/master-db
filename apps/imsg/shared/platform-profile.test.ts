import { describe, expect, test } from "bun:test";

import { IMESSAGE_PROFILE, reactionSupport, support, type Feature, type ProfileRoute } from "./platform-profile";

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

test("only the six tapbacks send, and none on SMS", () => {
  expect(reactionSupport(dm("iMessage"), "love")).toEqual({ ok: true });
  expect(reactionSupport(dm("iMessage"), "emoji")).toEqual({ ok: false, reason: "iMessage can't send that reaction" });
  expect(reactionSupport(dm("SMS"), "love")).toEqual({ ok: false, reason: "SMS can't send reactions" });
});
