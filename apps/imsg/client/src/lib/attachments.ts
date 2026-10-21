export const MAX_PENDING_ATTACHMENTS = 10;
/** The agent runner's cap; the pane refuses a larger file before uploading it. */
export const AGENT_ATTACHMENT_LIMIT = 100 * 1024 * 1024;

export interface PendingAttachmentAsset {
  uri: string;
  name: string;
  mime: string;
  isImage: boolean;
  cleanup: "object-url" | "cache-file" | null;
  /** Bytes, when the source reports it. */
  size?: number;
}

export interface MergeAttachmentResult<T> {
  items: T[];
  rejected: T[];
}

export function browserFilesToAttachments(
  files: readonly File[],
  createObjectUrl: (file: File) => string,
): PendingAttachmentAsset[] {
  return files.map((file, index) => {
    const mime = file.type || "application/octet-stream";
    return {
      uri: createObjectUrl(file),
      name: file.name || `pasted-${index + 1}`,
      mime,
      isImage: mime.startsWith("image/"),
      cleanup: "object-url",
    };
  });
}

export function mergePendingAttachments<T>(
  current: readonly T[],
  incoming: readonly T[],
  max = MAX_PENDING_ATTACHMENTS,
): MergeAttachmentResult<T> {
  const available = Math.max(0, max - current.length);
  return {
    items: [...current, ...incoming.slice(0, available)],
    rejected: incoming.slice(available),
  };
}

/** An item of unknown size passes; the runner checks it again. */
export function splitOversized<T extends { size?: number }>(incoming: readonly T[], limit: number): MergeAttachmentResult<T> {
  const over = (item: T) => (item.size ?? 0) > limit;
  return { items: incoming.filter((item) => !over(item)), rejected: incoming.filter(over) };
}

export function releaseObjectUrl(
  attachment: Pick<PendingAttachmentAsset, "cleanup" | "uri">,
  revoke: (uri: string) => void,
): boolean {
  if (attachment.cleanup !== "object-url") return false;
  revoke(attachment.uri);
  return true;
}

interface FileTransfer {
  files: ArrayLike<File>;
  items: ArrayLike<{ kind: string; getAsFile(): File | null }>;
}

/** Files carried by a paste or drop; some browsers expose them only as items. */
export function filesFromTransfer(transfer: FileTransfer | null): File[] {
  if (!transfer) return [];
  const direct = Array.from(transfer.files);
  if (direct.length > 0) return direct;
  return Array.from(transfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

/**
 * Stops a file dropped outside every drop target from navigating the window to
 * that file. Drops a target already accepted keep their drop effect.
 */
export function guardWindowFileDrops(
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
): () => void {
  const block = (event: Event): void => {
    const transfer = (event as DragEvent).dataTransfer;
    if (event.defaultPrevented || !transfer?.types.includes("Files")) return;
    event.preventDefault();
    transfer.dropEffect = "none";
  };
  target.addEventListener("dragover", block);
  target.addEventListener("drop", block);
  return () => {
    target.removeEventListener("dragover", block);
    target.removeEventListener("drop", block);
  };
}
