import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../../_generated/api";
import { ALLOWED_EMAIL } from "../../_lib/authed";
import schema from "../../schema";
import { normalizeModules } from "../../test-utils.vitest";

import type { TodoistItemWithProject } from "./getItemsByViewWithProjects";

const modules = normalizeModules(
  import.meta.glob("../../**/*.*s"),
  import.meta.url,
);

type SeedArgs = {
  entity_id: string;
  task_content?: string;
  checked?: boolean;
  project?: { todoist_id: string; name: string; color: string };
};

async function seedRun(
  t: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  args: SeedArgs,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agenticRuns", {
      entity_ref: `todoist:task:${args.entity_id}`,
      entity_type: "todoist_task",
      entity_id: args.entity_id,
      backend: "claude_sdk",
      resume_cursor: null,
      status: "awaiting_decision",
      last_message_id: null,
      last_run_id: "01H",
      last_traceparent: null,
      updated_at: Date.now(),
    });
    if (args.project) {
      await ctx.db.insert("todoist_projects", {
        todoist_id: args.project.todoist_id,
        name: args.project.name,
        color: args.project.color,
        child_order: 0,
        is_deleted: false,
        is_archived: false,
        is_favorite: false,
        view_style: "list",
        sync_version: 1,
      });
    }
    await ctx.db.insert("todoist_items", {
      todoist_id: args.entity_id,
      content: args.task_content ?? `Task ${args.entity_id}`,
      child_order: 0,
      priority: 1,
      ...(args.project && { project_id: args.project.todoist_id }),
      labels: [],
      comment_count: 0,
      checked: args.checked ?? false,
      is_deleted: false,
      added_at: "2026-01-01T00:00:00Z",
      user_id: "u1",
      sync_version: 1,
    });
  });
}

// Seed a todoist_item with no agenticRun (should be excluded).
async function seedTaskWithoutRun(
  t: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  entity_id: string,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("todoist_items", {
      todoist_id: entity_id,
      content: `Task ${entity_id}`,
      child_order: 0,
      priority: 1,
      labels: [],
      comment_count: 0,
      checked: false,
      is_deleted: false,
      added_at: "2026-01-01T00:00:00Z",
      user_id: "u1",
      sync_version: 1,
    });
  });
}

describe("getItemsByViewWithProjects — agent-queue branch", () => {
  test("returns only tasks that have an agenticRun, project-joined", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL });
    await seedRun(t, {
      entity_id: "a",
      task_content: "Has run A",
      project: { todoist_id: "p1", name: "AUF", color: "lavender" },
    });
    await seedRun(t, { entity_id: "b", task_content: "Has run B" });
    await seedTaskWithoutRun(t, "c");

    const rows: TodoistItemWithProject[] = await t.query(
      api.todoist.queries.getItemsByViewWithProjects.getItemsByViewWithProjects,
      { list: { type: "agent-queue", view: "view:agent-queue" } },
    );

    expect(rows.map((r) => r.todoist_id).sort()).toEqual(["a", "b"]);
    const a = rows.find((r) => r.todoist_id === "a");
    expect(a?.project).toEqual({ todoist_id: "p1", name: "AUF", color: "lavender" });
    const b = rows.find((r) => r.todoist_id === "b");
    expect(b?.project).toBeNull();
  });

  test("includes completed (checked) tasks that have a run", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL });
    await seedRun(t, { entity_id: "open", checked: false });
    await seedRun(t, { entity_id: "done", checked: true });

    const rows: TodoistItemWithProject[] = await t.query(
      api.todoist.queries.getItemsByViewWithProjects.getItemsByViewWithProjects,
      { list: { type: "agent-queue", view: "view:agent-queue" } },
    );

    expect(rows.map((r) => r.todoist_id).sort()).toEqual(["done", "open"]);
  });

  test("skips runs whose todoist_item is missing or deleted", async () => {
    const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL });
    await seedRun(t, { entity_id: "live" });
    // Run pointing at a non-existent item.
    await t.run(async (ctx) => {
      await ctx.db.insert("agenticRuns", {
        entity_ref: "todoist:task:ghost",
        entity_type: "todoist_task",
        entity_id: "ghost",
        backend: "claude_sdk",
        resume_cursor: null,
        status: "idle",
        last_message_id: null,
        last_run_id: "01H",
        last_traceparent: null,
        updated_at: Date.now(),
      });
      // Run pointing at a deleted item.
      await ctx.db.insert("agenticRuns", {
        entity_ref: "todoist:task:gone",
        entity_type: "todoist_task",
        entity_id: "gone",
        backend: "claude_sdk",
        resume_cursor: null,
        status: "idle",
        last_message_id: null,
        last_run_id: "01H",
        last_traceparent: null,
        updated_at: Date.now(),
      });
      await ctx.db.insert("todoist_items", {
        todoist_id: "gone",
        content: "Deleted task",
        child_order: 0,
        priority: 1,
        labels: [],
        comment_count: 0,
        checked: false,
        is_deleted: true,
        added_at: "2026-01-01T00:00:00Z",
        user_id: "u1",
        sync_version: 1,
      });
    });

    const rows: TodoistItemWithProject[] = await t.query(
      api.todoist.queries.getItemsByViewWithProjects.getItemsByViewWithProjects,
      { list: { type: "agent-queue", view: "view:agent-queue" } },
    );

    expect(rows.map((r) => r.todoist_id)).toEqual(["live"]);
  });
});
