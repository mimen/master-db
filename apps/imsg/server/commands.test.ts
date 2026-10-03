import { expect, test } from "bun:test";
import { FakeBlueBubbles } from "./bluebubbles-fake";
import { ChatDirectory } from "./chat-directory";
import { ChatCommands } from "./commands";
import { ContactBook } from "./contacts";
import { OverlayDb } from "./db";

const CHAT = "iMessage;-;+15550001111";

test("shared send validates text, passes the client key, and updates the directory", async () => {
  const bb = new FakeBlueBubbles({ chats: [{ guid: CHAT, participants: [{ address: "+15550001111" }], messages: [] }] });
  const contacts = new ContactBook(bb);
  const directory = new ChatDirectory(bb, new OverlayDb(":memory:"), contacts);
  const commands = new ChatCommands(bb, directory, contacts);
  expect(await commands.send(CHAT, { text: " " }, "key")).toMatchObject({ ok: false, status: 400 });
  const result = await commands.send(CHAT, { text: "hello" }, "key");
  expect(result).toMatchObject({ ok: true, value: { text: "hello", isFromMe: true } });
  const messages = await bb.chatMessages(CHAT);
  expect(messages).toMatchObject({ ok: true, value: [{ tempGuid: "key" }] });
  const summaries = await directory.summaries();
  expect(summaries).toMatchObject({ ok: true, chats: [{ lastMessage: { text: "hello" } }] });
});
