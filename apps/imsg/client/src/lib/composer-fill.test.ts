import { describe, expect, test } from "bun:test";
import type { ConversationId } from "@shared/types";
import { fillComposer, onFillComposer } from "./composer-fill";

const CHANNEL = "conv-channel" as ConversationId;
const THREAD = "conv-thread" as ConversationId;

describe("composer fill stack", () => {
  test("restores the underlying composer after an overlay unmounts", () => {
    const heard: string[] = [];
    const removeBase = onFillComposer(CHANNEL, (fill) => heard.push(`base:${fill.text}`));
    const removeOverlay = onFillComposer(CHANNEL, (fill) => heard.push(`overlay:${fill.text}`));

    fillComposer(CHANNEL, "one");
    removeOverlay();
    fillComposer(CHANNEL, "two");
    removeBase();
    fillComposer(CHANNEL, "ignored");

    expect(heard).toEqual(["overlay:one", "base:two"]);
  });

  test("a suggestion fills its own conversation's composer when a thread panel mounts a second one", () => {
    const heard: string[] = [];
    const removeChannel = onFillComposer(CHANNEL, (fill) => heard.push(`channel:${fill.text}`));
    const removeThread = onFillComposer(THREAD, (fill) => heard.push(`thread:${fill.text}`));

    fillComposer(CHANNEL, "for the channel");
    fillComposer(THREAD, "for the thread");
    removeThread();
    removeChannel();

    expect(heard).toEqual(["channel:for the channel", "thread:for the thread"]);
  });
});
