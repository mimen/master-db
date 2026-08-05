import type { BBChat, BBMessage } from "./bb-types";
import { stripServiceSuffix } from "../shared/address";

export function normalizeSendAddress(address: string): string {
  const cleaned = stripServiceSuffix(address).trim();
  if (cleaned.includes("@")) return cleaned.toLowerCase();
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (cleaned.startsWith("+") && digits.length >= 8) return `+${digits}`;
  return cleaned;
}

export function sameSendAddress(a: string, b: string): boolean {
  return normalizeSendAddress(a) === normalizeSendAddress(b);
}

export function outboundAddressesError(addresses: readonly string[]): string | null {
  if (addresses.length === 0) return "addresses are required";
  const normalized = addresses.map(normalizeSendAddress);
  if (normalized.some((address) => address.length === 0)) return "addresses must not be empty";
  if (new Set(normalized).size !== normalized.length) return "duplicate recipient addresses";
  return null;
}

function normalizedAddressCounts(addresses: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const address of addresses) {
    const normalized = normalizeSendAddress(address);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return counts;
}

export function createdChatError(
  chat: BBChat,
  requestedAddresses: readonly string[],
  sent: BBMessage,
): string | null {
  const expectedGuidShape = requestedAddresses.length === 1 ? /^iMessage;-;/i : /^iMessage;\+;/i;
  if (!expectedGuidShape.test(chat.guid)) {
    return requestedAddresses.length === 1
      ? "created chat is not a one-to-one iMessage chat"
      : "created chat is not a group iMessage chat";
  }
  const participants = (chat.participants ?? []).map((participant) => participant.address);
  const requestedError = outboundAddressesError(requestedAddresses);
  const participantError = outboundAddressesError(participants);
  if (requestedError || participantError) {
    return `created chat has invalid recipients: ${requestedError ?? participantError}`;
  }
  const requestedCounts = normalizedAddressCounts(requestedAddresses);
  const participantCounts = normalizedAddressCounts(participants);
  if (
    requestedCounts.size !== participantCounts.size ||
    [...requestedCounts].some(([address, count]) => participantCounts.get(address) !== count)
  ) {
    return "created chat participants do not match the requested addresses";
  }
  if (sent.isFromMe !== true) return "created message is not outgoing";
  return null;
}

export function selectCreatedChatMessage(
  chat: BBChat,
  tempGuid: string,
  expectedText: string,
): BBMessage | null {
  return (
    (chat.messages ?? []).find(
      (message) =>
        message.tempGuid === tempGuid &&
        message.isFromMe === true &&
        message.text === expectedText,
    ) ?? null
  );
}

export function outboundTextError(text: string | undefined): string | null {
  if (typeof text !== "string" || text.trim().length === 0) return "empty message";
  if (text !== text.trim()) return "message must not have leading or trailing whitespace";
  return null;
}

export function messageBelongsToAnyChat(
  message: BBMessage,
  allowedChatGuids: readonly string[],
): boolean {
  const allowed = new Set(allowedChatGuids);
  return (message.chats ?? []).some((chat) => allowed.has(chat.guid));
}
