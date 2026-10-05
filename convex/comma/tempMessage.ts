/** Temp row guid for a queued send; the bridge's echo replaces it by clientKey. */
export function tempGuid(clientKey: string): string {
  return `temp-${clientKey}`;
}

/** The service a queued send's temp bubble shows. RCS counts as SMS, as BlueBubbles reports RCS messages. */
export function sendService(chatGuid: string): "iMessage" | "SMS" {
  return chatGuid.startsWith("SMS;") || chatGuid.startsWith("RCS;") ? "SMS" : "iMessage";
}
