import { mkdir } from "node:fs/promises";
import { basename, join, relative, resolve, isAbsolute } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { formatMessages } from "./context";
import type { ChatId, ConversationId, Port, StorageId } from "./convex-port";

type ToolResult = Awaited<ReturnType<Parameters<typeof tool>[3]>>;

export type ToolDeps = {
  port: Port;
  chatId: ChatId;
  conversationId: ConversationId;
  scratchDir: string;
  timeZone: string;
  fetch: (url: string) => Promise<Response>;
};

const text = (value: string): ToolResult => ({ content: [{ type: "text", text: value }] });

async function guarded(work: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await work();
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
}

/** Resolves a scratch-relative or absolute path, refusing anything outside the chat's scratch folder. */
export function scratchPath(scratchDir: string, path: string): string {
  const full = resolve(scratchDir, path);
  const inside = relative(scratchDir, full);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new Error(`${path} is outside the scratch folder ${scratchDir}`);
  return full;
}

async function download(deps: ToolDeps, url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const response = await deps.fetch(url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  return { bytes: new Uint8Array(await response.arrayBuffer()), mime: response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream" };
}

/** The comma MCP tools, bound to one chat's conversation and scratch folder. */
export function commaTools(deps: ToolDeps) {
  const { port, chatId, conversationId } = deps;
  const staged: StorageId[] = [];
  return [
    tool("read_thread", "Read this conversation's messages before a point in time, newest last. Page back with the oldest timestamp you have seen.", {
      beforeMessageAt: z.number().optional().describe("Epoch milliseconds; omit for the latest messages"),
      limit: z.number().int().min(1).max(200).default(40),
    }, (args) => guarded(async () => {
      const context = await port.post("agentContext", { conversationId, beforeMessageAt: args.beforeMessageAt, limit: args.limit });
      const oldest = context.messages[0]?.at;
      return text(`${formatMessages(context.messages, deps.timeZone)}${oldest ? `\n\n(oldest shown: ${oldest})` : "\n\n(no messages)"}`);
    })),
    tool("search_thread", "Search this conversation's full history.", { query: z.string().min(1) },
      (args) => guarded(async () => {
        const messages = await port.post("agentSearch", { conversationId, query: args.query });
        return text(messages.length ? formatMessages(messages, deps.timeZone) : "(no matches)");
      })),
    tool("get_people", "List this conversation's participants with handles, emails and CRM fields.", {},
      () => guarded(async () => text(JSON.stringify(await port.post("agentPeople", { conversationId }))))),
    tool("get_attachment", "Download an attachment from this thread into the scratch folder. Images are returned for you to see.", { guid: z.string() },
      (args) => guarded(async () => {
        const attachment = await port.post("agentAttachment", { guid: args.guid });
        if (!attachment) throw new Error(`No attachment ${args.guid} in this thread`);
        if (!attachment.url) throw new Error(`Attachment ${args.guid} has not been copied to Comma's storage yet`);
        const { bytes, mime: served } = await download(deps, attachment.url);
        const mime = attachment.mime ?? served;
        await mkdir(deps.scratchDir, { recursive: true });
        const path = join(deps.scratchDir, basename(attachment.name ?? "") || args.guid);
        await Bun.write(path, bytes);
        const saved = `Saved ${attachment.name ?? args.guid} (${mime}) to ${path}`;
        if (!mime.startsWith("image/")) return text(saved);
        return { content: [{ type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: mime }, { type: "text", text: saved }] };
      })),
    tool("attach_file", "Stage a file for the next set_draft call: a path inside the scratch folder, or a URL.", {
      path: z.string().optional(),
      url: z.string().url().optional(),
    }, (args) => guarded(async () => {
      if (!args.path === !args.url) throw new Error("Pass exactly one of path or url");
      const file = args.path
        ? await (async () => {
          const full = scratchPath(deps.scratchDir, args.path!);
          const blob = Bun.file(full);
          return { name: basename(full), bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type.split(";")[0] };
        })()
        : { name: basename(new URL(args.url!).pathname) || "attachment", ...await download(deps, args.url!) };
      const storageId = await port.upload(file.bytes, file.mime);
      const recorded = await port.post("agentRecordUpload", { storageId, filename: file.name, mimeType: file.mime });
      staged.push(recorded.storageId);
      return text(`Staged ${file.name} (${recorded.size} bytes). Call set_draft to place it with the reply.`);
    })),
    tool("set_draft", "Put a reply in this conversation's composer, with an optional note for Milad and any staged files. If he has typed there, it shows in the pane instead.", {
      text: z.string(),
      note: z.string().optional(),
    }, (args) => guarded(async () => {
      const attachments = staged.splice(0);
      const { placed } = await port.post("agentDraft", {
        chatId, conversationId, itemKey: `draft-${crypto.randomUUID()}`, text: args.text, note: args.note,
        ...(attachments.length ? { attachments } : {}),
      });
      return text(placed === "composer"
        ? "The draft is in the composer."
        : "Milad has typed in the composer, so the draft is shown in the pane with a Use in composer button.");
    })),
    tool("send_message", "Send text to this conversation through Comma's outbox. Only send text Milad approved.", { text: z.string().min(1) },
      (args) => guarded(async () => {
        await port.post("agentSend", { conversationId, clientKey: `agent-${crypto.randomUUID()}`, text: args.text });
        return text("Queued for sending.");
      })),
  ];
}

export const commaServer = (deps: ToolDeps) => createSdkMcpServer({ name: "comma", tools: commaTools(deps) });
