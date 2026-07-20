import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Per-chat draft text. Kept in memory for instant read/write and mirrored to
 * AsyncStorage so drafts survive a reload.
 */
const memory = new Map<string, string>();
let hydrated = false;
const KEY = "imsg.drafts.v1";

export async function hydrateDrafts(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      for (const [guid, text] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
        memory.set(guid, text);
      }
    }
  } catch {
    // storage unavailable — drafts are memory-only this session
  }
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

export function setDraft(chatGuid: string, text: string): void {
  if (text.trim()) memory.set(chatGuid, text);
  else memory.delete(chatGuid);
  scheduleFlush();
}
