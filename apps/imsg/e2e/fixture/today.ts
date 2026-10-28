import type { GenericId } from "convex/values";
import type { TodayQueue, TodayRun, TodayView } from "../../../../convex/schema/comma/validators";
import { matchesFilters } from "../../shared/chat-state";
import { todayWindow } from "../../shared/today";
import type { ChatSummary } from "../../shared/types";
import { FIXTURE_NOW, TODAY_SEED } from "./world";

export type TodayMode = "seeded" | "unbuilt" | "failed";

/** How long a fixture Regenerate stays building: past the client's 500 ms poll, so the busy state is seen. */
const BUILD_MS = 2_500;
const FAILED_AT = todayWindow(FIXTURE_NOW).start + 7 * 3_600_000;

const id = (value: string) => value as GenericId<"comma_conversations">;

function seededQueue(): TodayQueue {
  const seeded = TODAY_SEED.groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.id })));
  const items = seeded.map((item, index) => ({ conversationId: id(item.conversationId), rank: index + 1, group: item.group, reason: item.reason }));
  const open = [...seeded.filter((item) => !item.waiting).map((item) => id(item.conversationId)), ...TODAY_SEED.below.map(id)];
  return {
    snapshotAt: TODAY_SEED.snapshotAt, model: TODAY_SEED.model, brief: TODAY_SEED.brief, readCount: TODAY_SEED.readCount, candidateCount: TODAY_SEED.candidateCount,
    groups: TODAY_SEED.groups.map(({ id: groupId, title, context }) => ({ id: groupId, title, context })),
    items, openAtSnapshot: open,
  };
}

const REGENERATED_GROUPS = [
  { id: "first", title: "Start here", context: "The threads with a clock on them today." },
  { id: "rest", title: "Everything else", context: "Real threads with no deadline today." },
];

/**
 * The fixture's comma_today_queue: one row the client reads through comma/today:get, built from
 * TODAY_SEED. A Regenerate ranks the known Needs you conversations newest first into two groups.
 */
export function createTodayFixture(deps: {
  chats: () => Promise<ChatSummary[]>;
  clears: () => { chatGuid: string; clearedAt: number }[];
  canonical: (chatGuid: string) => string;
}) {
  const dayStart = todayWindow(FIXTURE_NOW).start;
  let run: TodayRun | null = null;
  let queue: TodayQueue | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function setMode(mode: TodayMode): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (mode === "unbuilt") {
      run = null;
      queue = null;
    } else if (mode === "failed") {
      run = { status: "failed", attempt: 1, source: "schedule", failedAt: FAILED_AT, error: "The gateway timed out" };
      queue = null;
    } else {
      run = { status: "done", attempt: 1, source: "schedule", finishedAt: TODAY_SEED.snapshotAt + 40_000 };
      queue = seededQueue();
    }
  }
  setMode("seeded");

  async function build(attempt: number, snapshotAt: number): Promise<void> {
    const open = (await deps.chats())
      .filter((chat) => matchesFilters(chat, "unresponded", "known") && chat.flags.unresponded)
      .sort((a, b) => (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0));
    const half = Math.ceil(open.length / 2);
    queue = {
      snapshotAt, model: TODAY_SEED.model, readCount: open.length, candidateCount: open.length,
      brief: "Rebuilt from what is open now. Start with the newest threads.",
      groups: REGENERATED_GROUPS,
      items: open.slice(0, 50).map((chat, index) => ({
        conversationId: id(chat.guid), rank: index + 1, group: index < half ? "first" : "rest",
        reason: index < half ? "Newest open thread." : "Open since earlier.",
      })),
      openAtSnapshot: open.map((chat) => id(chat.guid)),
    };
    run = { status: "done", attempt, source: "user", finishedAt: Date.now() };
  }

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "comma/today:get": async (args): Promise<TodayView | null> => {
      if (!run) return null;
      const latest = new Map<string, number>();
      for (const { chatGuid, clearedAt } of deps.clears()) {
        if (clearedAt < dayStart) continue;
        const key = deps.canonical(chatGuid);
        latest.set(key, Math.max(latest.get(key) ?? 0, clearedAt));
      }
      return {
        day: String(args.day), dayStart, run, queue,
        cleared: [...latest].map(([conversationId, at]) => ({ conversationId: id(conversationId), at })),
      };
    },
    "comma/today:requestBuild": async () => {
      if (run?.status === "requested" || run?.status === "building") return run;
      const attempt = (run?.attempt ?? 0) + 1;
      const startedAt = Date.now();
      run = { status: "building", attempt, source: "user", requestedAt: startedAt, startedAt, claimId: "fixture" };
      timer = setTimeout(() => { timer = null; void build(attempt, startedAt); }, BUILD_MS);
      return run;
    },
  };

  return { handlers, setMode, reset: () => setMode("seeded") };
}
