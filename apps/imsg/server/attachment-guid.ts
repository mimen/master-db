/** Converts a BlueBubbles attachment GUID into a safe, stable filename segment. */
export function safeAttachmentGuid(guid: string): string {
  return guid.replace(/[^A-Za-z0-9-]/g, "_");
}
