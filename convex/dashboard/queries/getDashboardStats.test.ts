import { describe, test, expect } from "vitest";

import {
  aggregateDashboardStats,
  computeDayBoundariesISO,
  extractStartTime,
  type DashboardStats,
} from "./getDashboardStats";

// Minimal Doc shapes for the aggregator. The aggregator only reads the fields
// referenced below; the real Doc<> types include more, but we cast at the
// aggregator boundary to keep these fixtures small and readable.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

function makeItem(overrides: Partial<{
  todoist_id: string;
  content: string;
  priority: number;
  project_id: string | undefined;
  due: { date: string; datetime?: string } | undefined;
}> = {}): AnyDoc {
  return {
    todoist_id: overrides.todoist_id ?? "item_1",
    content: overrides.content ?? "Task",
    priority: overrides.priority ?? 1,
    project_id: overrides.project_id,
    due: overrides.due,
  };
}

function makeProject(overrides: Partial<{
  todoist_id: string;
  name: string;
  color: string;
  inbox_project: boolean | null;
  parent_id: string | undefined;
}>): AnyDoc {
  return {
    todoist_id: overrides.todoist_id ?? "p1",
    name: overrides.name ?? "Project",
    color: overrides.color ?? "grey",
    inbox_project: overrides.inbox_project ?? false,
    parent_id: overrides.parent_id,
  };
}

function makeRoutine(overrides: Partial<{
  defer: boolean;
  completionRateOverall: number | null;
}>): AnyDoc {
  return {
    defer: overrides.defer ?? false,
    completionRateOverall: overrides.completionRateOverall ?? null,
  };
}

describe("computeDayBoundariesISO", () => {
  test("returns YYYY-MM-DD for today and today + 7 in UTC", () => {
    // Fixed instant: 2026-05-15 10:00 UTC. timezone offset 0.
    const t = Date.UTC(2026, 4, 15, 10, 0, 0);
    const { todayISO, sevenDaysISO } = computeDayBoundariesISO(0, t);
    expect(todayISO).toBe("2026-05-15");
    expect(sevenDaysISO).toBe("2026-05-22");
  });

  test("applies timezone offset westward (Pacific, +480)", () => {
    // 2026-05-15 04:00 UTC = 2026-05-14 21:00 PT
    const t = Date.UTC(2026, 4, 15, 4, 0, 0);
    const { todayISO } = computeDayBoundariesISO(480, t);
    expect(todayISO).toBe("2026-05-14");
  });

  test("applies timezone offset eastward (Tokyo, -540)", () => {
    // 2026-05-15 18:00 UTC = 2026-05-16 03:00 JST
    const t = Date.UTC(2026, 4, 15, 18, 0, 0);
    const { todayISO } = computeDayBoundariesISO(-540, t);
    expect(todayISO).toBe("2026-05-16");
  });
});

describe("extractStartTime", () => {
  test("returns HH:MM when datetime is set", () => {
    expect(
      extractStartTime({ date: "2026-05-15", datetime: "2026-05-15T09:30:00Z" })
    ).toBe("09:30");
  });

  test("returns null when due has no datetime", () => {
    expect(extractStartTime({ date: "2026-05-15" })).toBeNull();
  });

  test("returns null when due is undefined", () => {
    expect(extractStartTime(undefined)).toBeNull();
  });

  test("returns null for malformed datetime", () => {
    expect(extractStartTime({ date: "2026-05-15", datetime: "garbage" })).toBeNull();
  });
});

describe("aggregateDashboardStats", () => {
  const today = "2026-05-15";
  const sevenDays = "2026-05-22";
  const nowMs = Date.UTC(2026, 4, 15, 16, 0, 0);

  function build(overrides: Partial<{
    items: AnyDoc[];
    projects: AnyDoc[];
    routines: AnyDoc[];
    overdueRoutineTaskCount: number;
  }> = {}): DashboardStats {
    return aggregateDashboardStats({
      items: overrides.items ?? [],
      projects: overrides.projects ?? [],
      routines: overrides.routines ?? [],
      overdueRoutineTaskCount: overrides.overdueRoutineTaskCount ?? 0,
      todayISO: today,
      sevenDaysISO: sevenDays,
      nowMs,
    });
  }

  test("returns zeros when there is no data", () => {
    const stats = build();
    expect(stats.overdue).toBe(0);
    expect(stats.dueToday).toBe(0);
    expect(stats.dueThisWeek).toBe(0);
    expect(stats.inbox).toBe(0);
    expect(stats.p1Active).toBe(0);
    expect(stats.priorityCounts).toEqual({ p1: 0, p2: 0, p3: 0, p4: 0, total: 0 });
    expect(stats.topProjects).toEqual([]);
    expect(stats.todayQueue).toEqual([]);
    expect(stats.routines).toEqual({
      active: 0,
      paused: 0,
      avgCompletion: 0,
      overdueRoutineTasks: 0,
    });
    expect(stats.generatedAt).toBe(nowMs);
  });

  test("counts overdue / today / this-week based on due.date strings", () => {
    const stats = build({
      items: [
        makeItem({ due: { date: "2026-05-10" } }), // overdue
        makeItem({ due: { date: "2026-05-14" } }), // overdue
        makeItem({ due: { date: today } }), // today (and within week)
        makeItem({ due: { date: today } }),
        makeItem({ due: { date: "2026-05-20" } }), // this week
        makeItem({ due: { date: "2026-05-30" } }), // future, not this week
        makeItem({ due: undefined }), // no date
      ],
    });
    expect(stats.overdue).toBe(2);
    expect(stats.dueToday).toBe(2);
    // dueThisWeek includes today and the 2026-05-20 item.
    expect(stats.dueThisWeek).toBe(3);
  });

  test("maps Todoist API priorities to UI buckets (4=P1, 1=P4)", () => {
    const stats = build({
      items: [
        makeItem({ priority: 4 }),
        makeItem({ priority: 4 }),
        makeItem({ priority: 3 }),
        makeItem({ priority: 2 }),
        makeItem({ priority: 1 }),
        makeItem({ priority: 1 }),
        makeItem({ priority: 1 }),
      ],
    });
    expect(stats.priorityCounts).toEqual({
      p1: 2,
      p2: 1,
      p3: 1,
      p4: 3,
      total: 7,
    });
    expect(stats.p1Active).toBe(2);
  });

  test("inbox count uses inbox_project flag; top projects exclude inbox", () => {
    const projects = [
      makeProject({ todoist_id: "inbox", name: "Inbox", inbox_project: true }),
      makeProject({ todoist_id: "auf", name: "AUF" }),
      makeProject({ todoist_id: "health", name: "Health" }),
    ];
    const stats = build({
      projects,
      items: [
        makeItem({ project_id: "inbox" }),
        makeItem({ project_id: "inbox" }),
        makeItem({ project_id: "auf" }),
        makeItem({ project_id: "auf" }),
        makeItem({ project_id: "auf" }),
        makeItem({ project_id: "health" }),
      ],
    });
    expect(stats.inbox).toBe(2);
    expect(stats.topProjects).toEqual([
      { todoistId: "auf", name: "AUF", color: "grey", activeTaskCount: 3 },
      { todoistId: "health", name: "Health", color: "grey", activeTaskCount: 1 },
    ]);
  });

  test("today queue is ordered by start time, timed items first", () => {
    const stats = build({
      items: [
        makeItem({
          todoist_id: "afternoon",
          content: "Afternoon",
          due: { date: today, datetime: `${today}T14:00:00Z` },
        }),
        makeItem({
          todoist_id: "untimed-z",
          content: "Z untimed",
          due: { date: today },
        }),
        makeItem({
          todoist_id: "morning",
          content: "Morning",
          due: { date: today, datetime: `${today}T09:00:00Z` },
        }),
        makeItem({
          todoist_id: "untimed-a",
          content: "A untimed",
          due: { date: today },
        }),
      ],
    });
    expect(stats.todayQueue.map((q) => q.todoistId)).toEqual([
      "morning",
      "afternoon",
      "untimed-a",
      "untimed-z",
    ]);
    expect(stats.todayQueue[0].startTime).toBe("09:00");
    expect(stats.todayQueue[2].startTime).toBeNull();
  });

  test("routine summary averages only non-null completion rates", () => {
    const stats = build({
      routines: [
        makeRoutine({ defer: false, completionRateOverall: 80 }),
        makeRoutine({ defer: false, completionRateOverall: 60 }),
        makeRoutine({ defer: false, completionRateOverall: null }), // ignored
        makeRoutine({ defer: true, completionRateOverall: 90 }), // paused, ignored
      ],
      overdueRoutineTaskCount: 4,
    });
    expect(stats.routines.active).toBe(3);
    expect(stats.routines.paused).toBe(1);
    expect(stats.routines.avgCompletion).toBe(70); // (80 + 60) / 2
    expect(stats.routines.overdueRoutineTasks).toBe(4);
  });

  test("identifies inbox by name when inbox_project flag is null (Todoist mirror quirk)", () => {
    // Real-world mirror data: inbox_project is null on the Inbox project.
    // Fallback identifies by name + no parent.
    const projects = [
      makeProject({
        todoist_id: "inbox",
        name: "Inbox",
        inbox_project: null,
        parent_id: undefined,
      }),
      makeProject({ todoist_id: "auf", name: "AUF" }),
    ];
    const stats = build({
      projects,
      items: [
        makeItem({ project_id: "inbox" }),
        makeItem({ project_id: "inbox" }),
        makeItem({ project_id: "auf" }),
      ],
    });
    expect(stats.inbox).toBe(2);
    expect(stats.topProjects.map((p) => p.todoistId)).toEqual(["auf"]);
  });

  test("does not treat a sub-project named 'Inbox' as the system inbox", () => {
    const projects = [
      makeProject({
        todoist_id: "real-inbox",
        name: "Inbox",
        inbox_project: true,
        parent_id: undefined,
      }),
      makeProject({
        todoist_id: "subproj-inbox",
        name: "Inbox",
        parent_id: "other-project",
      }),
    ];
    const stats = build({
      projects,
      items: [
        makeItem({ project_id: "real-inbox" }),
        makeItem({ project_id: "subproj-inbox" }),
      ],
    });
    expect(stats.inbox).toBe(1);
  });

  test("handles items with datetime in due.date by extracting the date part", () => {
    const stats = build({
      items: [
        // Defensive: some clients store the full ISO in due.date.
        makeItem({ due: { date: `${today}T12:00:00Z` } }),
      ],
    });
    expect(stats.dueToday).toBe(1);
  });
});
