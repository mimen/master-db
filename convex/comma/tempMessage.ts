/** Temp row guid for a queued send; the bridge's echo replaces it by clientKey. */
export function tempGuid(clientKey: string): string {
  return `temp-${clientKey}`;
}

/** The service a queued send's temp bubble shows, from the chat it goes out on. */
export function sendService(chatGuid: string): "iMessage" | "SMS" {
  return chatGuid.startsWith("SMS;") ? "SMS" : "iMessage";
}
