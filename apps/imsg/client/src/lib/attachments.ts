export const MAX_PENDING_ATTACHMENTS = 10;

export interface PendingAttachmentAsset {
  uri: string;
  name: string;
  mime: string;
  isImage: boolean;
  cleanup: "object-url" | "cache-file" | null;
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

export function releaseObjectUrl(
  attachment: Pick<PendingAttachmentAsset, "cleanup" | "uri">,
  revoke: (uri: string) => void,
): boolean {
  if (attachment.cleanup !== "object-url") return false;
  revoke(attachment.uri);
  return true;
}
