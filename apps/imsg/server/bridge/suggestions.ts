import type { OverlayDb } from "../db";
import type { ReplySuggestions, SuggestionModel } from "../../shared/types";
import type { ConvexIngest, MessageRow } from "./convex-ingest";

export type ShelfUpdate =
  | { kind: "publish"; conversationId: MessageRow["conversationId"]; model: SuggestionModel; suggestions: ReplySuggestions; startedAt: number }
  | { kind: "clear"; clientKey: string; clearedAt: number };

export async function publishShelf(ingest: Pick<ConvexIngest, "post">, update: ShelfUpdate): Promise<boolean> {
  // The shared transport's kind map is owned by the composition workstream.
  const post = ingest.post as unknown as (kind: "suggestionShelves", body: { update: ShelfUpdate }) => Promise<boolean>;
  return post.call(ingest, "suggestionShelves", { update });
}

/** Convex queues a precompute on each fresh inbound DM (comma/suggestions:precompute); this caps the model calls a day. */
export const PRECOMPUTE_DAILY_CAP = 150;
const BUDGET_KEY = "suggestion_precompute_budget";

/** Person summaries Convex queues a day; each is one cheap-model call. */
export const PERSON_SUMMARY_DAILY_CAP = 100;
export const PERSON_SUMMARY_BUDGET = { key: "person_summary_budget", cap: PERSON_SUMMARY_DAILY_CAP } as const;

/** The day's count of model calls nobody asked for, kept in the Overlay so a restart does not reset it. */
export class PrecomputeBudget {
  private day = "";
  private generatedToday = 0;
  private lastAt: number | null = null;
  private key: string;
  private cap: number;

  constructor(
    private db: Pick<OverlayDb, "getAiMeta" | "setAiMeta">,
    private now: () => number = Date.now,
    { key, cap }: { key: string; cap: number } = { key: BUDGET_KEY, cap: PRECOMPUTE_DAILY_CAP },
  ) {
    this.key = key;
    this.cap = cap;
    const saved = db.getAiMeta(key);
    if (!saved) return;
    try {
      const budget: unknown = JSON.parse(saved);
      if (budget && typeof budget === "object" && "day" in budget && typeof budget.day === "string" &&
        "generatedToday" in budget && typeof budget.generatedToday === "number" && Number.isSafeInteger(budget.generatedToday) && budget.generatedToday >= 0) {
        this.day = budget.day;
        this.generatedToday = budget.generatedToday;
        if ("lastAt" in budget && typeof budget.lastAt === "number") this.lastAt = budget.lastAt;
      } else throw new Error("invalid suggestion budget");
    } catch (error) {
      // An unreadable budget spends nothing more today rather than risk a second day's worth.
      console.error(`comma ai ${key}: ${String(error)}`);
      this.day = this.today();
      this.generatedToday = this.cap;
    }
  }

  /** Spends one precompute; false once today's cap is spent. */
  take(): boolean {
    this.resetDay();
    if (this.generatedToday >= this.cap) return false;
    this.generatedToday++;
    this.lastAt = this.now();
    this.save();
    return true;
  }

  health() {
    this.resetDay();
    return { generatedToday: this.generatedToday, cap: this.cap, lastAt: this.lastAt };
  }

  private today(): string { return new Date(this.now()).toISOString().slice(0, 10); }

  private resetDay(): void {
    const day = this.today();
    if (day === this.day) return;
    this.day = day;
    this.generatedToday = 0;
    this.save();
  }

  private save(): void {
    this.db.setAiMeta(this.key, JSON.stringify({ day: this.day, generatedToday: this.generatedToday, lastAt: this.lastAt }));
  }
}
