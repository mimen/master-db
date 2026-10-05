import type { Message } from "@shared/types";
import { formatBubbleTime, formatReceiptTime } from "@/lib/format";

/** The status your newest sent bubble carries; null while a send is still quick, since iMessage stays silent then. */
function latestStatus(message: Message, slowSend: boolean): string | null {
  if (message.pending) return slowSend ? "Sending…" : null;
  if (message.dateRead !== null) return `Read ${formatReceiptTime(message.dateRead)}`;
  return message.dateDelivered !== null ? "Delivered" : "Sent";
}

/** The caption line under a bubble, or null for none. */
export function receiptText({
  message,
  isLatestOutgoing,
  slowSend,
  showTime,
}: {
  message: Message;
  isLatestOutgoing: boolean;
  slowSend: boolean;
  showTime: boolean;
}): string | null {
  const parts: string[] = [];
  if (message.edited) parts.push("Edited");
  const status = message.isFromMe && isLatestOutgoing ? latestStatus(message, slowSend) : null;
  if (status !== null) parts.push(status);
  else if (showTime) parts.push(formatBubbleTime(message.dateCreated));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/**
 * The inbound run after your last reply, oldest first: where it starts in `messages` and how many
 * messages it holds. Event lines don't count. With no reply yet, or none since, the run is empty.
 */
export function sinceYourReply(messages: readonly Message[]): { start: number; count: number } {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.isGroupEvent) continue;
    if (message.isFromMe) return count === 0 ? { start: messages.length, count: 0 } : { start: firstInbound(messages, i + 1), count };
    count++;
  }
  return { start: messages.length, count: 0 };
}

function firstInbound(messages: readonly Message[], from: number): number {
  let i = from;
  while (messages[i]?.isGroupEvent) i++;
  return i;
}
