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

/** The day's precompute count, kept in the Overlay so a restart does not reset it. */
export class PrecomputeBudget {
  private day = "";
  private generatedToday = 0;
  private lastAt: number | null = null;

  constructor(private db: Pick<OverlayDb, "getAiMeta" | "setAiMeta">, private now: () => number = Date.now) {
    const saved = db.getAiMeta(BUDGET_KEY);
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
      console.error(`comma ai suggestions budget: ${String(error)}`);
      this.day = this.today();
      this.generatedToday = PRECOMPUTE_DAILY_CAP;
    }
  }

  /** Spends one precompute; false once today's cap is spent. */
  take(): boolean {
    this.resetDay();
    if (this.generatedToday >= PRECOMPUTE_DAILY_CAP) return false;
    this.generatedToday++;
    this.lastAt = this.now();
    this.save();
    return true;
  }

  health() {
    this.resetDay();
    return { generatedToday: this.generatedToday, cap: PRECOMPUTE_DAILY_CAP, lastAt: this.lastAt };
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
    this.db.setAiMeta(BUDGET_KEY, JSON.stringify({ day: this.day, generatedToday: this.generatedToday, lastAt: this.lastAt }));
  }
}
