import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ConversationId } from "@shared/types";

/**
 * Per-conversation draft text. Kept in memory for instant read/write and mirrored to
 * AsyncStorage so drafts survive a reload.
 */
const memory = new Map<ConversationId, string>();
let hydration: Promise<void> | undefined;
const touched = new Set<ConversationId>();
const listeners = new Set<(conversationId: ConversationId, text: string) => void>();
// v1 was keyed by chat GUID and has been imported into Convex drafts.
const KEY = "imsg.drafts.v2";

export function hydrateDrafts(): Promise<void> {
  return hydration ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const stored: unknown = raw ? JSON.parse(raw) : null;
      if (stored && typeof stored === "object") {
        for (const [id, text] of Object.entries(stored)) {
          const conversationId = id as ConversationId;
          if (typeof text === "string" && !touched.has(conversationId)) memory.set(conversationId, text);
        }
      }
    } catch {
      // Storage unavailable, drafts remain in memory this session.
    }
  })();
}

export function getDraft(conversationId: ConversationId): string {
  return memory.get(conversationId) ?? "";
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    void AsyncStorage.setItem(KEY, JSON.stringify(Object.fromEntries(memory))).catch(() => undefined);
  }, 400);
}

export function setDraft(conversationId: ConversationId, text: string, source: "local" | "remote" = "local"): void {
  touched.add(conversationId);
  if (text.trim()) memory.set(conversationId, text);
  else memory.delete(conversationId);
  scheduleFlush();
  if (source === "local") for (const listener of listeners) listener(conversationId, text);
}

export function subscribeDrafts(listener: (conversationId: ConversationId, text: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
