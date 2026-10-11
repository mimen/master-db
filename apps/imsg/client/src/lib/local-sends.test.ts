import { afterEach, expect, test } from "bun:test";
import type { Message } from "@shared/types";
import { localSends, resetLocalSendsForTests, tempMessage } from "./local-sends";

const ALEX = "iMessage;-;+16195550101";
const JORDAN = "iMessage;-;+16195550102";

afterEach(resetLocalSendsForTests);

test("a send made outside a thread waits under its own chat, then settles into the real message's row", () => {
  const temp = tempMessage(JORDAN, "forwarded");
  localSends.upsert(JORDAN, temp);
  expect(localSends.read(ALEX)).toEqual([]);
  expect(localSends.read(JORDAN).map((m) => [m.guid, m.pending])).toEqual([[temp.guid, true]]);

  const real: Message = { ...temp, guid: "real-1", pending: undefined, clientKey: undefined };
  localSends.settle(JORDAN, temp.guid, real);
  expect(localSends.read(JORDAN).map((m) => [m.guid, m.clientKey, m.pending])).toEqual([["real-1", temp.guid, undefined]]);
});

test("retain drops only the rejected sends and leaves an untouched chat's list identical", () => {
  const first = tempMessage(ALEX, "one");
  const second = tempMessage(ALEX, "two");
  localSends.upsert(ALEX, first);
  localSends.upsert(ALEX, second);
  const before = localSends.read(ALEX);
  localSends.retain(ALEX, () => true);
  expect(localSends.read(ALEX)).toBe(before);
  localSends.retain(ALEX, (m) => m.guid !== first.guid);
  expect(localSends.read(ALEX).map((m) => m.text)).toEqual(["two"]);
});

test("a temp is the user's pending send in the chat's service, keyed for the outbox", () => {
  const sms = tempMessage("SMS;-;+16195550103", "hi");
  expect(sms).toMatchObject({ isFromMe: true, pending: true, service: "SMS", text: "hi" });
  expect(sms.clientKey).toBe(sms.guid);
  expect(sms.guid.startsWith("temp-")).toBe(true);
});
