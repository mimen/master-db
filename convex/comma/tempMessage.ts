/** Temp row guid for a queued send; the bridge's echo replaces it by clientKey. */
export function tempGuid(clientKey: string): string {
  return `temp-${clientKey}`;
}
