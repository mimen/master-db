import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { api } from "../../_generated/api";
import { ALLOWED_EMAIL } from "../../_lib/authed";
import schema from "../../schema";
import { normalizeModules } from "../../test-utils.vitest";

const moveTasks = vi.fn();
vi.mock("./utils/todoistClient", () => ({ getTodoistClient: () => ({ moveTasks }) }));

const modules = normalizeModules(import.meta.glob("../../**/*.*s"), import.meta.url);

async function seed(fields: { section_id?: string; parent_id?: string }) {
  const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL });
  await t.run((ctx) =>
    ctx.db.insert("todoist_items", {
      todoist_id: "task-1",
      content: "Task",
      project_id: "project-a",
      ...fields,
      child_order: 0,
      priority: 1,
      labels: [],
      comment_count: 0,
      checked: false,
      is_deleted: false,
      added_at: "2026-01-01T00:00:00Z",
      user_id: "user",
      sync_version: 1,
    }),
  );
  const row = () =>
    t.run((ctx) =>
      ctx.db.query("todoist_items").withIndex("by_todoist_id", (q) => q.eq("todoist_id", "task-1")).unique(),
    );
  return { t, row };
}

afterEach(() => moveTasks.mockReset());

describe("moveTask", () => {
  test("a project move leaves the old section and parent behind", async () => {
    const { t, row } = await seed({ section_id: "section-a", parent_id: "parent-a" });
    moveTasks.mockResolvedValue([{ projectId: "project-b", sectionId: null, parentId: null, updatedAt: "2026-01-02T00:00:00Z" }]);

    const result = await t.action(api.todoist.actions.moveTask.moveTask, { todoistId: "task-1", projectId: "project-b" });

    expect(result).toMatchObject({ success: true });
    const moved = await row();
    expect(moved?.project_id).toBe("project-b");
    expect(moved).not.toHaveProperty("section_id");
    expect(moved).not.toHaveProperty("parent_id");
  });

  test("a parent move records the new parent", async () => {
    const { t, row } = await seed({});
    moveTasks.mockResolvedValue([{ projectId: "project-a", sectionId: null, parentId: "parent-b", updatedAt: "2026-01-02T00:00:00Z" }]);

    const result = await t.action(api.todoist.actions.moveTask.moveTask, { todoistId: "task-1", parentId: "parent-b" });

    expect(result).toMatchObject({ success: true });
    expect((await row())?.parent_id).toBe("parent-b");
  });

  test("a failed move restores the original placement", async () => {
    const { t, row } = await seed({ section_id: "section-a", parent_id: "parent-a" });
    moveTasks.mockRejectedValue(new Error("Todoist down"));

    const result = await t.action(api.todoist.actions.moveTask.moveTask, { todoistId: "task-1", projectId: "project-b" });

    expect(result).toMatchObject({ success: false });
    expect(await row()).toMatchObject({ project_id: "project-a", section_id: "section-a", parent_id: "parent-a" });
  });
});
