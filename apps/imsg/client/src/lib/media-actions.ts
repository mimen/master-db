import { useCallback } from "react";
import { Platform } from "react-native";
import { useActionSheet } from "@/lib/action-sheet";
import { showToast } from "@/lib/toast";

export interface ShareableMedia {
  url: string;
  isVideo: boolean;
  filename?: string | null;
  mimeType?: string | null;
}

export type MediaActionResult =
  | { ok: true }
  | { ok: false; message: string };

interface CachedMediaFile {
  uri: string;
  exists: boolean;
  delete(): void;
}

type DownloadResult =
  | { ok: true; file: CachedMediaFile }
  | { ok: false; message: string };

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
};

function extensionFor(media: ShareableMedia): string {
  const original = media.filename?.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  if (original && /^(heic|heif|tif|tiff)$/.test(original)) return "jpg";
  if (original) return original;
  if (media.mimeType && /image\/(heic|heif|tiff)/i.test(media.mimeType)) return "jpg";
  return (media.mimeType && MIME_EXTENSIONS[media.mimeType.toLowerCase()]) ?? (media.isVideo ? "mov" : "jpg");
}

function cacheFilename(media: ShareableMedia): string {
  const base = (media.filename?.replace(/\.[^.]+$/, "") || (media.isVideo ? "message-video" : "message-photo"))
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  let hash = 2166136261;
  for (let i = 0; i < media.url.length; i++) {
    hash ^= media.url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${base || "message-media"}-${(hash >>> 0).toString(16)}.${extensionFor(media)}`;
}

async function downloadMedia(media: ShareableMedia): Promise<DownloadResult> {
  try {
    const { File, Paths } = await import("expo-file-system");
    const destination = new File(Paths.cache, cacheFilename(media));
    const file = await File.downloadFileAsync(media.url, destination, { idempotent: true });
    return { ok: true, file };
  } catch {
    return { ok: false, message: "Couldn't download this attachment" };
  }
}

function removeCachedFile(file: CachedMediaFile): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup should not turn a completed save/share into a failure.
  }
}

export async function saveMediaToPhotos(media: ShareableMedia): Promise<MediaActionResult> {
  if (Platform.OS === "web") {
    return { ok: false, message: "Save to Photos is available in the iOS app" };
  }

  const MediaLibrary = await import("expo-media-library");
  if (!(await MediaLibrary.isAvailableAsync())) {
    return { ok: false, message: "Photos isn't available on this device" };
  }
  const permission = await MediaLibrary.requestPermissionsAsync(
    true,
    [media.isVideo ? "video" : "photo"],
  );
  if (!permission.granted) {
    return { ok: false, message: "Photos permission is required to save this attachment" };
  }

  const download = await downloadMedia(media);
  if (!download.ok) return download;
  try {
    await MediaLibrary.saveToLibraryAsync(download.file.uri);
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't save this attachment" };
  } finally {
    removeCachedFile(download.file);
  }
}

export async function shareMedia(media: ShareableMedia): Promise<MediaActionResult> {
  if (Platform.OS === "web") {
    return { ok: false, message: "Sharing attachments is available in the iOS app" };
  }

  const Sharing = await import("expo-sharing");
  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, message: "Sharing isn't available on this device" };
  }

  const download = await downloadMedia(media);
  if (!download.ok) return download;
  try {
    await Sharing.shareAsync(download.file.uri, { mimeType: media.mimeType ?? undefined });
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't share this attachment" };
  } finally {
    removeCachedFile(download.file);
  }
}

export function useMediaActionSheet(): (media: ShareableMedia) => void {
  const showSheet = useActionSheet();
  return useCallback(
    (media) => {
      showSheet({
        actions: [
          {
            label: "Save to Photos",
            onPress: () => {
              void saveMediaToPhotos(media).then((result) => {
                showToast(result.ok ? "Saved to Photos" : result.message);
              });
            },
          },
          {
            label: "Share…",
            onPress: () => {
              void shareMedia(media).then((result) => {
                if (!result.ok) showToast(result.message);
              });
            },
          },
        ],
      });
    },
    [showSheet],
  );
}
