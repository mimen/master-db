import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readSelfHandles } from "./self-handles";

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function chatDb(logins: (string | null)[]): string {
  dir = mkdtempSync(join(tmpdir(), "self-handles-"));
  const path = join(dir, "chat.db");
  const db = new Database(path);
  db.exec("CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, account_login TEXT)");
  logins.forEach((login, index) => db.query("INSERT INTO chat (guid, account_login) VALUES (?, ?)").run(`chat${index}`, login));
  db.close();
  return path;
}

test("the account's handles are the phone and email Messages signs in with, once each", () => {
  const path = chatDb(["P:+15550001111", "E:me@example.com", "P:+15550001111", "E:", null]);
  expect(readSelfHandles(path)).toEqual(["+15550001111", "me@example.com"]);
});

test("an unreadable chat.db leaves the account's handles as they are", () => {
  expect(readSelfHandles("/nonexistent/chat.db")).toBeUndefined();
});
