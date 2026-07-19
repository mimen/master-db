import { mkdirSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = ".cache/attachments";
mkdirSync(CACHE_DIR, { recursive: true });

export interface TranscodeResult {
  path: string;
  contentType: string;
}

function needsImageTranscode(mimeType: string | null, filename: string | null): boolean {
  if (mimeType && /image\/(heic|heif|tiff)/i.test(mimeType)) return true;
  if (filename && /\.(heic|heif|tiff?)$/i.test(filename)) return true;
  return false;
}

function needsAudioTranscode(mimeType: string | null, filename: string | null): boolean {
  if (mimeType && /audio\/(x-caf|amr)/i.test(mimeType)) return true;
  if (filename && /\.(caf|amr)$/i.test(filename)) return true;
  return false;
}

async function run(cmd: string[]): Promise<boolean> {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  return (await proc.exited) === 0;
}

/**
 * Converts browser-hostile formats (HEIC/TIFF images, CAF/AMR audio) to
 * JPEG / AAC-M4A via macOS's sips/afconvert, cached on disk by attachment guid.
 * Returns null when no transcode is needed or conversion fails.
 */
export async function transcodeAttachment(
  guid: string,
  mimeType: string | null,
  filename: string | null,
  download: () => Promise<Response>,
): Promise<TranscodeResult | null> {
  const image = needsImageTranscode(mimeType, filename);
  const audio = !image && needsAudioTranscode(mimeType, filename);
  if (!image && !audio) return null;

  const safeGuid = guid.replace(/[^A-Za-z0-9-]/g, "_");
  const outPath = join(CACHE_DIR, `${safeGuid}.${image ? "jpg" : "m4a"}`);
  const contentType = image ? "image/jpeg" : "audio/mp4";

  if (await Bun.file(outPath).exists()) return { path: outPath, contentType };

  const res = await download();
  if (!res.ok) return null;
  const ext = filename?.split(".").pop() ?? (image ? "heic" : "caf");
  const inPath = join(CACHE_DIR, `${safeGuid}.orig.${ext.replace(/[^A-Za-z0-9]/g, "")}`);
  await Bun.write(inPath, await res.arrayBuffer());

  const ok = image
    ? await run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "85", inPath, "--out", outPath])
    : await run(["afconvert", "-f", "m4af", "-d", "aac", inPath, outPath]);

  if (!ok || !(await Bun.file(outPath).exists())) return null;
  return { path: outPath, contentType };
}
