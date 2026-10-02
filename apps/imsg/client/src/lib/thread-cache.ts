import type { Message } from "@shared/types";

export const THREAD_CACHE_KEY = "imsg.threadCache.v1";
export const THREAD_CACHE_MAX = 30;
const MAX_BYTES = 2 * 1024 * 1024;

type CacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readThreadCache(storage: CacheStorage): Map<string, Message[]> {
  try {
    const raw = storage.getItem(THREAD_CACHE_KEY);
    if (!raw || raw.length * 2 > MAX_BYTES) return new Map();
    const data = JSON.parse(raw) as { version?: unknown; threads?: unknown };
    if (data?.version !== 1 || !Array.isArray(data.threads)) return new Map();
    const threads = new Map<string, Message[]>();
    for (const entry of data.threads.slice(-THREAD_CACHE_MAX)) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !Array.isArray(entry[1])) return new Map();
      if (!entry[1].every((m: Message | null) =>
        m && typeof m.guid === "string" && m.chatGuid === entry[0] &&
        typeof m.text === "string" && Number.isFinite(m.dateCreated) &&
        typeof m.isFromMe === "boolean" && Array.isArray(m.attachments) &&
        m.attachments.every((a) => a && typeof a.guid === "string" &&
          (a.mimeType === null || typeof a.mimeType === "string") &&
          (a.filename === null || typeof a.filename === "string")) &&
        Array.isArray(m.reactions) && m.reactions.every((r) => r && typeof r.type === "string") &&
        (m.sender === null || (m.sender && typeof m.sender.address === "string" &&
          (m.sender.name === null || typeof m.sender.name === "string"))) &&
        (m.special === null || (m.special &&
          ["contact", "location", "apple-cash", "poll", "unknown"].includes(m.special.kind) &&
          (m.special.kind !== "contact" || m.special.name === null || typeof m.special.name === "string"))) &&
        (m.mentions === undefined || (Array.isArray(m.mentions) && m.mentions.every((mention) =>
          mention && Number.isFinite(mention.start) && Number.isFinite(mention.length) &&
          typeof mention.address === "string")))
      )) return new Map();
      threads.set(entry[0], entry[1]);
    }
    return threads;
  } catch {
    return new Map();
  }
}

export function writeThreadCache(storage: CacheStorage, cache: ReadonlyMap<string, Message[]>): void {
  const threads = [...cache].slice(-THREAD_CACHE_MAX).map(([guid, messages]) =>
    [guid, messages.filter((message) => !message.pending && !message.failed)] as const,
  );
  try {
    while (threads.length) {
      const raw = JSON.stringify({ version: 1, threads });
      if (raw.length * 2 <= MAX_BYTES) {
        try {
          storage.setItem(THREAD_CACHE_KEY, raw);
          return;
        } catch (error) {
          if (!(error instanceof Error) || error.name !== "QuotaExceededError") return;
        }
      }
      threads.shift();
    }
    storage.removeItem(THREAD_CACHE_KEY);
  } catch {
    // Storage can be disabled even when localStorage exists.
  }
}
