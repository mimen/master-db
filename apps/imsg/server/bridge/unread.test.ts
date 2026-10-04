import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeBlueBubbles } from "../bluebubbles-fake";
import { OverlayDb } from "../db";
import { FakeIngest } from "./fake-ingest";
import { MessageWriter } from "./live";
import { appleDateToMs, UnreadMirror } from "./unread";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

const NS = 1e9;
// A 2026 date in chat.db's seconds-since-2001.
const BASE = 812_000_000;
async function chatDb(rows: { chat: string; date: number; fromMe?: boolean; read?: boolean; tapback?: boolean }[]) {
  const dir = await mkdtemp(join(tmpdir(), "comma-unread-"));
  dirs.push(dir);
  const path = join(dir, "chat.db");
  const db = new Database(path);
  db.exec(`CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, date INTEGER, is_from_me INTEGER, is_read INTEGER,
      associated_message_type INTEGER, item_type INTEGER, group_action_type INTEGER, date_retracted INTEGER);`);
  const chats = new Map<string, number>();
  for (const row of rows) {
    if (!chats.has(row.chat)) {
      chats.set(row.chat, chats.size + 1);
      db.run("INSERT INTO chat VALUES (?, ?)", [chats.size, row.chat]);
    }
    const { lastInsertRowid } = db.run("INSERT INTO message (date, is_from_me, is_read, associated_message_type, item_type, group_action_type, date_retracted) VALUES (?, ?, ?, ?, 0, 0, 0)",
      [(BASE + row.date) * NS, Number(row.fromMe ?? false), Number(row.read ?? false), row.tapback ? 2000 : 0]);
    db.run("INSERT INTO chat_message_join VALUES (?, ?)", [chats.get(row.chat)!, Number(lastInsertRowid)]);
  }
  db.close();
  return path;
}

test("counts only inbound messages after the last read or sent one in each chat", async () => {
  const path = await chatDb([
    { chat: "A", date: 1 }, { chat: "A", date: 2, fromMe: true }, { chat: "A", date: 3 }, { chat: "A", date: 4 },
    { chat: "A", date: 5, tapback: true },
    // Apple never marked the old group rows read, but the later read covers them.
    { chat: "B", date: 1 }, { chat: "B", date: 2, read: true },
    { chat: "C", date: 7 },
  ]);
  const ingest = new FakeIngest();
  const bb = new FakeBlueBubbles({ chats: [] });
  const mirror = new UnreadMirror(new MessageWriter({ bb, db: new OverlayDb(":memory:"), ingest }), { chatDbPath: path });
  await mirror.flush();
  mirror.stop();
  const posted = ingest.calls.filter((call) => call.kind === "unread").at(-1)!.body as { chats: { chatGuid: string; count: number; firstAt: number }[] };
  expect(posted.chats.sort((a, b) => a.chatGuid.localeCompare(b.chatGuid))).toEqual([
    { chatGuid: "A", count: 2, firstAt: Date.UTC(2001, 0, 1) + (BASE + 3) * 1000 },
    { chatGuid: "C", count: 1, firstAt: Date.UTC(2001, 0, 1) + (BASE + 7) * 1000 },
  ]);
});

test("reads both nanosecond and legacy second dates from the 2001 epoch", () => {
  const expected = Date.UTC(2001, 0, 1) + BASE * 1000;
  expect(appleDateToMs(BASE)).toBe(expected);
  expect(appleDateToMs(BASE * NS)).toBe(expected);
});
