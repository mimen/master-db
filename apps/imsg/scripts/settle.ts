/**
 * Settles conversations the way ⌘E does, from a shell: comma/triage:settle anchored on each
 * conversation's newest message, which Convex applies and answers at once.
 *
 *   bun scripts/settle.ts <conversationId|name> [...]
 *
 * Writes real data: only for conversations Milad asked to settle. Runs `convex run` as Milad
 * (`--identity`), which the authed guards accept, against the deployment in the repo root's
 * .env.local.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const IDENTITY = JSON.stringify({ subject: "agent", email: "milad@afternoonumbrellafriends.com" });

function convex(args: string[]): string {
  const run = spawnSync("bunx", ["convex", ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(run.stderr.trim() || `convex ${args[0]} failed`);
  return run.stdout;
}

const asMilad = (fn: string, args: object): unknown => JSON.parse(convex(["run", "--identity", IDENTITY, fn, JSON.stringify(args)]) || "null");

interface Conversation { _id: string; displayName: string; lastMessage?: { guid: string; isFromMe: boolean } }
const conversations = convex(["data", "comma_conversations", "--limit", "20000", "--format", "jsonLines"])
  .split("\n").filter(Boolean).map((line) => JSON.parse(line) as Conversation);

const targets = process.argv.slice(2);
if (targets.length === 0) throw new Error("usage: bun scripts/settle.ts <conversationId|name> [...]");

for (const target of targets) {
  const matches = conversations.filter((c) => c._id === target || c.displayName.toLowerCase() === target.toLowerCase());
  if (matches.length !== 1) {
    console.log(`skip ${target}: ${matches.length} conversations match`);
    continue;
  }
  const conversation = matches[0]!;
  const anchor = conversation.lastMessage?.guid;
  if (!anchor) {
    console.log(`skip ${conversation.displayName}: no last message`);
    continue;
  }
  try {
    asMilad("comma/triage:settle", { conversationId: conversation._id, anchor });
    console.log(`settled: ${conversation.displayName}`);
  } catch (error) {
    console.log(`failed: ${conversation.displayName} (${error instanceof Error ? error.message.split("\n").at(-1) : String(error)})`);
  }
}
