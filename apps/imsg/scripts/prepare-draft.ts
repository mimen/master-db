/**
 * Prepares a draft reply in Comma for the user to review and send. It lands under the Drafts tab
 * with the note shown above the composer; nothing is sent. Runs `bunx convex run` from the repo
 * root, so it needs the Convex CLI's deployment access (the root .env.local).
 *
 *   bun scripts/prepare-draft.ts --to <address|chatGuid|conversationId> --text "Sounds good"
 *     [--note "Why this reply, never sent"] [--attach ./plan.pdf ...] [--force]
 *
 * --to takes a phone number or email in any format, a chat GUID (`iMessage;-;+14155552671`), or a
 * comma_conversations id. --attach repeats. --force replaces unsent text the user typed; without
 * it an existing user draft is left alone and the script fails. An earlier agent draft is replaced.
 */
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

export type Target = { conversationId: string } | { chatGuid: string } | { address: string };

export function parseTarget(to: string): Target {
  if (to.includes(";")) return { chatGuid: to };
  if (/^[0-9a-z]{25,40}$/.test(to) && /[a-z]/.test(to)) return { conversationId: to };
  return { address: to };
}

export function parseCli(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      to: { type: "string" },
      text: { type: "string", default: "" },
      note: { type: "string" },
      attach: { type: "string", multiple: true, default: [] },
      force: { type: "boolean", default: false },
    },
  });
  if (!values.to) throw new Error("--to is required");
  if (!values.text.trim() && values.attach.length === 0) throw new Error("Pass --text, --attach, or both");
  return { target: parseTarget(values.to), text: values.text, note: values.note, attach: values.attach, force: values.force };
}

function convexRun(fn: string, args: Record<string, unknown>): unknown {
  const run = Bun.spawnSync(["bunx", "convex", "run", fn, JSON.stringify(args)], { cwd: REPO_ROOT, stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`${fn} failed:\n${run.stderr.toString().trim()}`);
  return JSON.parse(run.stdout.toString());
}

// Bytes go through an upload URL rather than storeAttachment's base64 argument, which a shell
// argument caps near 1 MB.
async function upload(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`No file at ${path}`);
  const mimeType = file.type.split(";")[0] || "application/octet-stream";
  const url = convexRun("comma/drafts:generateUploadUrl", {}) as string;
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": mimeType }, body: file });
  if (!response.ok) throw new Error(`Upload of ${path} failed: ${response.status}`);
  const { storageId } = (await response.json()) as { storageId: string };
  convexRun("comma/drafts:recordUpload", { storageId, filename: basename(path), mimeType });
  return storageId;
}

if (import.meta.main) {
  const cli = parseCli(Bun.argv.slice(2));
  const attachments = [];
  for (const path of cli.attach) attachments.push(await upload(path));
  const result = convexRun("comma/drafts:prepareDraft", {
    ...cli.target,
    text: cli.text,
    ...(cli.note !== undefined ? { note: cli.note } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(cli.force ? { force: true } : {}),
  });
  console.log(JSON.stringify(result));
}
