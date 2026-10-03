import type { AiService } from "../ai/service";
import type { OverlayDb } from "../db";
import type { ChatSummary } from "../../shared/types";
import type { ConvexIngest, MessageRow } from "./convex-ingest";

export const SUGGESTION_PRECOMPUTE = {
  directMessagesOnly: true,
  knownContactsOnly: true,
  dailyCap: 150,
  debounceMs: 3000,
} as const;

export interface SuggestionDeps {
  ai: Pick<AiService, "available" | "replySuggestions"> & Partial<Pick<AiService, "cachedReplySuggestions">>;
  db: OverlayDb;
  ingest: Pick<ConvexIngest, "post">;
  getChat: (chatGuid: string) => Promise<ChatSummary | null>;
  now?: () => number;
}

type Pending = { message: MessageRow; dueAt: number };
const BUDGET_KEY = "suggestion_precompute_budget";

export class SuggestionsBridge {
  private queue = new Map<MessageRow["conversationId"], Pending>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private now: () => number;
  private day = "";
  private generatedToday = 0;
  private lastAt: number | null = null;

  constructor(private deps: SuggestionDeps) {
    this.now = deps.now ?? Date.now;
    const saved = deps.db.getAiMeta(BUDGET_KEY);
    if (saved) {
      try {
        const budget: unknown = JSON.parse(saved);
        if (budget && typeof budget === "object" && "day" in budget && typeof budget.day === "string" &&
          "generatedToday" in budget && typeof budget.generatedToday === "number" && Number.isSafeInteger(budget.generatedToday) && budget.generatedToday >= 0) {
          this.day = budget.day;
          this.generatedToday = budget.generatedToday;
          if ("lastAt" in budget && typeof budget.lastAt === "number") this.lastAt = budget.lastAt;
        } else throw new Error("invalid suggestion budget");
      } catch (error) {
        console.error(`comma bridge suggestions budget: ${String(error)}`);
        this.day = new Date(this.now()).toISOString().slice(0, 10);
        this.generatedToday = SUGGESTION_PRECOMPUTE.dailyCap;
      }
    }
  }

  health() {
    this.resetDay();
    return { generatedToday: this.generatedToday, cap: SUGGESTION_PRECOMPUTE.dailyCap, lastAt: this.lastAt };
  }

  observe(messages: MessageRow[]): void {
    if (this.stopped || !this.deps.ai.available) return;
    for (const message of [...messages].sort((a, b) => a.dateCreated - b.dateCreated)) {
      if (message.isTapback || message.isGroupEvent || message.retracted) continue;
      const previous = this.queue.get(message.conversationId);
      if (previous && previous.message.dateCreated > message.dateCreated) continue;
      if (message.isFromMe) this.queue.delete(message.conversationId);
      else this.queue.set(message.conversationId, { message, dueAt: this.now() + SUGGESTION_PRECOMPUTE.debounceMs });
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped || this.running || !this.queue.size) return;
    const dueAt = Math.min(...[...this.queue.values()].map((item) => item.dueAt));
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, Math.max(0, dueAt - this.now()));
    this.timer.unref();
  }

  async flush(): Promise<void> {
    if (this.running) return this.running;
    if (this.stopped) return;
    // ponytail: one precompute worker globally; split by account if throughput requires it.
    this.running = (async () => {
      for (const [id, item] of this.queue) {
        if (this.stopped) break;
        if (item.dueAt > this.now()) continue;
        this.queue.delete(id);
        try { await this.generate(item.message); }
        catch (error) { console.error(`comma bridge suggestions: ${String(error)}`); }
      }
    })();
    try { await this.running; }
    finally { this.running = null; this.schedule(); }
  }

  private async generate(message: MessageRow): Promise<void> {
    const chat = await this.deps.getChat(message.chatGuid);
    if (!chat || chat.lastMessage?.guid !== message.guid || chat.lastMessage.isFromMe || chat.isSpam ||
      (SUGGESTION_PRECOMPUTE.directMessagesOnly && (chat.isGroup || chat.participants.length !== 1)) ||
      (SUGGESTION_PRECOMPUTE.knownContactsOnly && !chat.participants[0]?.name?.trim())) return;
    const cached = await this.deps.ai.cachedReplySuggestions?.(message.chatGuid, message.guid, "opus");
    let result = cached;
    if (!result) {
      this.resetDay();
      if (this.generatedToday >= SUGGESTION_PRECOMPUTE.dailyCap) {
        console.warn(`comma bridge suggestions: daily cap ${SUGGESTION_PRECOMPUTE.dailyCap} reached`);
        return;
      }
      this.generatedToday++;
      this.lastAt = this.now();
      this.saveBudget();
      const generated = await this.deps.ai.replySuggestions(message.chatGuid, chat.displayName, false, "opus");
      if (!generated.ok) throw new Error(generated.error);
      result = generated.value;
    }
    if (this.stopped || result.stale || result.basedOnMessageGuid !== message.guid) return;
    const latest = await this.deps.getChat(message.chatGuid);
    if (latest?.lastMessage?.guid !== message.guid || latest.lastMessage.isFromMe) return;
    const { basedOnMessageGuid: _anchor, stale: _stale, generatedAt: _at, ...payload } = result;
    await this.deps.ingest.post("suggestions", { conversationId: message.conversationId, anchorGuid: message.guid, payload });
  }

  private resetDay(): void {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day === this.day) return;
    this.day = day;
    this.generatedToday = 0;
    this.saveBudget();
  }

  private saveBudget(): void {
    this.deps.db.setAiMeta(BUDGET_KEY, JSON.stringify({ day: this.day, generatedToday: this.generatedToday, lastAt: this.lastAt }));
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue.clear();
  }
}
