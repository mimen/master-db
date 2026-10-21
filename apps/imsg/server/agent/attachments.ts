import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentAttachmentLink } from "./convex-port";

export type UserContent = SDKUserMessage["message"]["content"];
type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

const IMAGE_TYPES = new Set<string>(["image/png", "image/jpeg", "image/gif", "image/webp"]);
// The Messages API rejects a larger image and fails the whole turn; such an image still goes by path.
const IMAGE_LIMIT = 5 * 1024 * 1024;

/**
 * Ported from T3 Code's Claude user message (apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts
 * at 05696c63, lines 1858-1906): image blocks go ahead of the text, and every file is saved to disk
 * and named by path in the text, so the agent can open or re-attach it.
 */
export async function userContent(text: string, attachments: AgentAttachmentLink[], deps: {
  fetch: (url: string) => Promise<Response>;
  dir: string;
}): Promise<UserContent> {
  if (!attachments.length) return text;
  await mkdir(deps.dir, { recursive: true });
  const images: Exclude<UserContent, string> = [];
  const notes: string[] = [];
  const names = new Set<string>();
  for (const [index, file] of attachments.entries()) {
    if (!file.url) {
      notes.push(`[Attached file "${file.filename}" is no longer stored]`);
      continue;
    }
    const response = await deps.fetch(file.url);
    if (!response.ok) throw new Error(`Downloading ${file.filename} failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const name = basename(file.filename) || "attachment";
    const path = join(deps.dir, names.has(name) ? `${index + 1}-${name}` : name);
    names.add(name);
    await writeFile(path, bytes);
    const image = IMAGE_TYPES.has(file.mimeType) && bytes.byteLength <= IMAGE_LIMIT;
    if (image) images.push({ type: "image", source: { type: "base64", media_type: file.mimeType as ImageType, data: Buffer.from(bytes).toString("base64") } });
    notes.push(`[Attached ${image ? "image" : "file"} "${file.filename}" is saved at: ${path}]`);
  }
  return [...images, { type: "text", text: [text, ...notes].filter(Boolean).join("\n\n") }];
}
