import { mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { safeAttachmentGuid } from "./attachment-guid";
import { downloadFailureReason } from "./bluebubbles";

/** Thread tiles render at most 260 CSS px wide; 2x covers retina. */
const WIDTHS = [260, 520, 1040] as const;
export type ThumbnailWidth = (typeof WIDTHS)[number];

export type ThumbnailResult = { ok: true; path: string } | { ok: false; reason: string };

/** Snaps a requested `?w=` up to a fixed bucket so each image caches a bounded set of sizes. */
export function parseThumbnailWidth(raw: string | undefined): ThumbnailWidth | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const requested = Number(raw);
  if (requested <= 0) return null;
  return WIDTHS.find((width) => width >= requested) ?? WIDTHS[WIDTHS.length - 1]!;
}

/** GIFs keep their animation, so they are always served whole. */
export function canThumbnail(mimeType: string | null, filename: string | null): boolean {
  if (mimeType) return mimeType.startsWith("image/") && mimeType !== "image/gif";
  return /\.(jpe?g|png|heic|heif|tiff?|webp|bmp)$/i.test(filename ?? "");
}

async function sips(args: string[]): Promise<string | null> {
  const proc = Bun.spawn(["sips", ...args], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  return (await proc.exited) === 0 ? out : null;
}

const inFlight = new Map<string, Promise<ThumbnailResult>>();

/**
 * Produces a small JPEG (long edge at most `width`, never upscaled) for an
 * image attachment, cached on disk by guid and width.
 */
export function thumbnailAttachment(
  guid: string,
  width: ThumbnailWidth,
  download: () => Promise<Response>,
  cacheDir = ".cache/attachments",
): Promise<ThumbnailResult> {
  const outPath = join(cacheDir, `${safeAttachmentGuid(guid)}.w${width}.jpg`);
  const active = inFlight.get(outPath);
  if (active) return active;
  const pending = render(outPath, width, download, cacheDir).finally(() => inFlight.delete(outPath));
  inFlight.set(outPath, pending);
  return pending;
}

async function render(
  outPath: string,
  width: ThumbnailWidth,
  download: () => Promise<Response>,
  cacheDir: string,
): Promise<ThumbnailResult> {
  if (await Bun.file(outPath).exists()) return { ok: true, path: outPath };

  const res = await download();
  if (!res.ok) return { ok: false, reason: await downloadFailureReason(res) };

  mkdirSync(cacheDir, { recursive: true });
  const stamp = `${process.pid}-${crypto.randomUUID()}`;
  const inPath = `${outPath}.${stamp}.in`;
  const tmpOut = `${outPath}.${stamp}.jpg`;
  try {
    await Bun.write(inPath, await res.arrayBuffer());
    // sips exits 0 on unreadable input and prints "<nil>", so a missing number is the failure signal.
    const dims = [...((await sips(["-g", "pixelWidth", "-g", "pixelHeight", inPath])) ?? "")
      .matchAll(/pixel(?:Width|Height): (\d+)/g)].map((m) => Number(m[1]));
    if (dims.length === 0) return { ok: false, reason: "not a readable image" };
    const resize = Math.max(...dims) > width ? ["-Z", String(width)] : [];
    const converted = await sips(["-s", "format", "jpeg", "-s", "formatOptions", "70", ...resize, inPath, "--out", tmpOut]);
    if (converted === null) return { ok: false, reason: "thumbnail conversion failed" };
    renameSync(tmpOut, outPath);
    return { ok: true, path: outPath };
  } finally {
    rmSync(inPath, { force: true });
    rmSync(tmpOut, { force: true });
  }
}
