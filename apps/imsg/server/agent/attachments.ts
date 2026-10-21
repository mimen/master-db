import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentAttachmentLink } from "./convex-port";

export type UserContent = SDKUserMessage["message"]["content"];
type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** The pane refuses a larger file before upload; one that arrives anyway is not downloaded. */
export const ATTACHMENT_LIMIT = 100 * 1024 * 1024;
// Anthropic's limits: a 2000px edge, and 5 MB of base64, which is 3.75 MB of bytes. A larger
// image fails the whole turn, so it is fitted first.
const IMAGE_EDGE = 2000;
const IMAGE_BYTES = 3.75 * 1024 * 1024;

const at = (bytes: Uint8Array, offset: number, ascii: string) => [...ascii].every((char, index) => bytes[offset + index] === char.charCodeAt(0));

/** The image type the bytes carry, whatever the upload declared. */
function sniff(bytes: Uint8Array): ImageType | null {
  if (bytes[0] === 0x89 && at(bytes, 1, "PNG\r\n\x1a\n")) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (at(bytes, 0, "GIF87a") || at(bytes, 0, "GIF89a")) return "image/gif";
  if (at(bytes, 0, "RIFF") && at(bytes, 8, "WEBP")) return "image/webp";
  return null;
}

async function sips(...args: string[]): Promise<string | null> {
  const child = Bun.spawn(["sips", ...args], { stdout: "pipe", stderr: "ignore" });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return code === 0 ? out : null;
}

/**
 * The image as the model gets it: the original when it is within Anthropic's limits, else a copy
 * fitted with macOS `sips` (scaled to the 2000px edge, then re-encoded as JPEG if still too heavy).
 * Null when the bytes are not an image `sips` can read, or cannot be brought under the limits.
 */
async function modelImage(path: string, head: Uint8Array): Promise<{ type: ImageType; data: Uint8Array } | null> {
  const type = sniff(head);
  const size = await sips("-g", "pixelWidth", "-g", "pixelHeight", path);
  const width = Number(/pixelWidth: (\d+)/.exec(size ?? "")?.[1]);
  const height = Number(/pixelHeight: (\d+)/.exec(size ?? "")?.[1]);
  if (!type || !width || !height) return null;
  const bytes = Bun.file(path).size;
  if (Math.max(width, height) <= IMAGE_EDGE && bytes <= IMAGE_BYTES) return { type, data: await Bun.file(path).bytes() };
  const fitted = `${path}.fitted`;
  if (await sips("-Z", String(Math.min(IMAGE_EDGE, Math.max(width, height))), path, "--out", fitted) === null) return null;
  if (Bun.file(fitted).size > IMAGE_BYTES && await sips("-s", "format", "jpeg", "-s", "formatOptions", "80", fitted, "--out", fitted) === null) return null;
  const data = await Bun.file(fitted).bytes();
  const fittedType = sniff(data);
  return fittedType && data.byteLength <= IMAGE_BYTES ? { type: fittedType, data } : null;
}

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
    if (file.size > ATTACHMENT_LIMIT) {
      notes.push(`[Attached file "${file.filename}" is over the 100 MB limit and was not downloaded]`);
      continue;
    }
    const response = await deps.fetch(file.url);
    if (!response.ok) throw new Error(`Downloading ${file.filename} failed: HTTP ${response.status}`);
    const name = basename(file.filename) || "attachment";
    const path = join(deps.dir, names.has(name) ? `${index + 1}-${name}` : name);
    names.add(name);
    await Bun.write(path, response);
    const image = file.mimeType.startsWith("image/") ? await modelImage(path, await Bun.file(path).slice(0, 12).bytes()) : null;
    if (image) images.push({ type: "image", source: { type: "base64", media_type: image.type, data: Buffer.from(image.data).toString("base64") } });
    notes.push(`[Attached ${image ? "image" : "file"} "${file.filename}" is saved at: ${path}]`);
  }
  return [...images, { type: "text", text: [text, ...notes].filter(Boolean).join("\n\n") }];
}
