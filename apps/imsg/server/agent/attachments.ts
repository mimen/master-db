import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentAttachmentLink } from "./convex-port";

export type UserContent = SDKUserMessage["message"]["content"];
type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** The pane refuses a larger file before upload; one that arrives anyway is not downloaded. */
const ATTACHMENT_LIMIT = 100 * 1024 * 1024;
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

const execFileAsync = promisify(execFile);

// Node's APIs rather than Bun's: the Convex contract test runs this module under vitest on Node.
async function sips(...args: string[]): Promise<string | null> {
  return execFileAsync("sips", args).then(({ stdout }) => stdout, () => null);
}

async function head(path: string): Promise<Uint8Array> {
  const file = await open(path);
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(12), 0, 12, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

async function download(response: Response, path: string): Promise<void> {
  if (!response.body) return writeFile(path, "");
  await pipeline(Readable.fromWeb(response.body as NodeReadableStream), createWriteStream(path));
}

/**
 * The image as the model gets it: the original when it is within Anthropic's limits, else a copy
 * fitted with macOS `sips` (scaled to the 2000px edge, then re-encoded as JPEG if still too heavy).
 * Null when the bytes are not an image `sips` can read, or cannot be brought under the limits.
 */
async function modelImage(path: string): Promise<{ type: ImageType; data: Uint8Array } | null> {
  const type = sniff(await head(path));
  const size = await sips("-g", "pixelWidth", "-g", "pixelHeight", path);
  const width = Number(/pixelWidth: (\d+)/.exec(size ?? "")?.[1]);
  const height = Number(/pixelHeight: (\d+)/.exec(size ?? "")?.[1]);
  if (!type || !width || !height) return null;
  if (Math.max(width, height) <= IMAGE_EDGE && (await stat(path)).size <= IMAGE_BYTES) return { type, data: await readFile(path) };
  const fitted = `${path}.fitted`;
  if (await sips("-Z", String(Math.min(IMAGE_EDGE, Math.max(width, height))), path, "--out", fitted) === null) return null;
  if ((await stat(fitted)).size > IMAGE_BYTES && await sips("-s", "format", "jpeg", "-s", "formatOptions", "80", fitted, "--out", fitted) === null) return null;
  const data = await readFile(fitted);
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
    await download(response, path);
    const image = file.mimeType.startsWith("image/") ? await modelImage(path) : null;
    if (image) images.push({ type: "image", source: { type: "base64", media_type: image.type, data: Buffer.from(image.data).toString("base64") } });
    notes.push(`[Attached ${image ? "image" : "file"} "${file.filename}" is saved at: ${path}]`);
  }
  return [...images, { type: "text", text: [text, ...notes].filter(Boolean).join("\n\n") }];
}
