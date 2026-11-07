import { expect, test } from "bun:test";
import { FakeBlueBubbles } from "./bluebubbles-fake";
import { ChatCommands } from "./commands";
import { ContactBook } from "./contacts";

const CHAT = "iMessage;-;+15550001111";
const SMS = "SMS;-;+15550001111";

test("shared send validates text and passes the client key", async () => {
  const bb = new FakeBlueBubbles({ chats: [{ guid: CHAT, participants: [{ address: "+15550001111" }], messages: [] }] });
  const commands = new ChatCommands(bb, new ContactBook(bb));
  expect(await commands.send(CHAT, { text: " " }, "key")).toMatchObject({ ok: false, status: 400 });
  const result = await commands.send(CHAT, { text: "hello" }, "key");
  expect(result).toMatchObject({ ok: true, value: { text: "hello", isFromMe: true } });
  const messages = await bb.chatMessages(CHAT);
  expect(messages).toMatchObject({ ok: true, value: [{ tempGuid: "key" }] });
});

test("mark read sends the receipt on every sibling it is given", async () => {
  const bb = new FakeBlueBubbles({ chats: [] });
  const commands = new ChatCommands(bb, new ContactBook(bb));
  expect(await commands.markRead([CHAT, SMS])).toBe(true);
  expect(bb.markReadCalls).toEqual([CHAT, SMS]);
});
