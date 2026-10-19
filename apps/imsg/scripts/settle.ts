/**
 * Settles conversations the way ⌘E does, from a shell: queues a `settle` command anchored on each
 * conversation's newest message, then waits for the Mini's answer.
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

const queued: { name: string; id: string }[] = [];
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
  const id = asMilad("comma/outbox:enqueue", {
    clientKey: `cli-settle-${conversation._id}-${anchor}`,
    conversationId: conversation._id,
    payload: { kind: "settle", messageGuid: anchor },
  }) as string;
  queued.push({ name: conversation.displayName, id });
}

// The bridge claims and answers within seconds; report each command's final status.
const deadline = Date.now() + 60_000;
const pending = new Map(queued.map((q) => [q.id, q.name]));
while (pending.size > 0 && Date.now() < deadline) {
  await Bun.sleep(2000);
  const rows = convex(["data", "comma_outbox", "--limit", "200", "--order", "desc", "--format", "jsonLines"])
    .split("\n").filter(Boolean).map((line) => JSON.parse(line) as { _id: string; status: string; error?: string });
  for (const row of rows) {
    const name = pending.get(row._id);
    if (!name || row.status === "pending" || row.status === "claimed") continue;
    console.log(`${row.status === "sent" ? "settled" : row.status}: ${name}${row.error ? ` (${row.error})` : ""}`);
    pending.delete(row._id);
  }
}
for (const name of pending.values()) console.log(`no answer yet: ${name}`);
