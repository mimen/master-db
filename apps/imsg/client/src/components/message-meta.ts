import type { Message } from "@shared/types";
import { formatBubbleTime } from "@/lib/format";

/** The status your newest sent bubble carries; null while a send is still quick, since iMessage stays silent then. */
function latestStatus(message: Message, slowSend: boolean): string | null {
  if (message.pending) return slowSend ? "Sending…" : null;
  if (message.dateRead !== null) return `Read ${formatBubbleTime(message.dateRead)}`;
  return message.dateDelivered !== null ? "Delivered" : "Sent";
}

/** The caption line under a bubble, or null for none. */
export function receiptText({
  message,
  isLatestOutgoing,
  slowSend,
  groupEnd,
  showTime,
}: {
  message: Message;
  isLatestOutgoing: boolean;
  slowSend: boolean;
  groupEnd: boolean;
  showTime: boolean;
}): string | null {
  const parts: string[] = [];
  if (message.edited) parts.push("Edited");
  const status = message.isFromMe && isLatestOutgoing ? latestStatus(message, slowSend) : null;
  if (status !== null) parts.push(status);
  else if (groupEnd || showTime) parts.push(formatBubbleTime(message.dateCreated));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
