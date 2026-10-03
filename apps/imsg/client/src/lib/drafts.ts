import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Per-chat draft text. Kept in memory for instant read/write and mirrored to
 * AsyncStorage so drafts survive a reload.
 */
const memory = new Map<string, string>();
let hydration: Promise<void> | undefined;
const touched = new Set<string>();
const listeners = new Set<(chatGuid: string, text: string) => void>();
const KEY = "imsg.drafts.v1";

export function hydrateDrafts(): Promise<void> {
  return hydration ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const stored: unknown = raw ? JSON.parse(raw) : null;
      if (stored && typeof stored === "object") {
        for (const [guid, text] of Object.entries(stored)) {
          if (typeof text === "string" && !touched.has(guid)) memory.set(guid, text);
        }
      }
    } catch {
      // Storage unavailable, drafts remain in memory this session.
    }
  })();
}

export function getDraft(chatGuid: string): string {
  return memory.get(chatGuid) ?? "";
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    void AsyncStorage.setItem(KEY, JSON.stringify(Object.fromEntries(memory))).catch(() => undefined);
  }, 400);
}

export function setDraft(chatGuid: string, text: string, source: "local" | "remote" = "local"): void {
  touched.add(chatGuid);
  if (text.trim()) memory.set(chatGuid, text);
  else memory.delete(chatGuid);
  scheduleFlush();
  if (source === "local") for (const listener of listeners) listener(chatGuid, text);
}

export function subscribeDrafts(listener: (chatGuid: string, text: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let upload: Promise<void> | undefined;
export function uploadLocalDrafts(write: (chatGuid: string, text: string) => Promise<void>): Promise<void> {
  return upload ??= (async () => {
    await hydrateDrafts();
    if (await AsyncStorage.getItem(`${KEY}.convex-uploaded`)) return;
    // ponytail: import at most 50 drafts, paginate if a larger local backlog matters.
    for (const [guid, text] of [...memory].filter(([, text]) => text.trim()).slice(0, 50)) {
      await write(guid, text);
    }
    await AsyncStorage.setItem(`${KEY}.convex-uploaded`, "1");
  })().catch((error: unknown) => {
    upload = undefined;
    throw error;
  });
}
