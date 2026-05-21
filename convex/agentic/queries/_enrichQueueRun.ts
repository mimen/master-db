import type { Doc } from "../../_generated/dataModel"
import type { QueryCtx } from "../../_generated/server"

/**
 * An agenticRuns row enriched with the display metadata the burndown queue
 * UI needs: the entity title plus, for todoist tasks, the task priority, due
 * date, and resolved project. Non-todoist entities carry the entity_ref as
 * the title and null metadata.
 *
 * `project.color` is the RAW todoist color string; the frontend computes the
 * display color via getProjectColor.
 */
export type EnrichedQueueRun = Doc<"agenticRuns"> & {
  entity_title: string
  description: string | null
  priority: number | null
  due: string | null
  deadline: string | null
  labels: Array<{ name: string; color: string }>
  project: { name: string; color: string } | null
  checked: boolean
}

/**
 * Enrich a single agenticRuns row with queue display metadata.
 *
 * Shared by listAwaitingDecision (queue rows) and getQueueEntityMeta
 * (right-pane header self-fetch) so both stay in lockstep.
 */
export async function enrichQueueRun(
  ctx: QueryCtx,
  run: Doc<"agenticRuns">,
): Promise<EnrichedQueueRun> {
  if (run.entity_type !== "todoist_task") {
    return {
      ...run,
      entity_title: run.entity_ref,
      description: null,
      priority: null,
      due: null,
      deadline: null,
      labels: [],
      project: null,
      checked: false,
    }
  }

  const task = await ctx.db
    .query("todoist_items")
    .withIndex("by_todoist_id", (q) => q.eq("todoist_id", run.entity_id))
    .unique()

  let project: { name: string; color: string } | null = null
  if (task?.project_id) {
    const proj = await ctx.db
      .query("todoist_projects")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", task.project_id!))
      .unique()
    if (proj) {
      project = { name: proj.name, color: proj.color }
    }
  }

  const labels = await Promise.all(
    (task?.labels ?? []).map(async (labelName) => {
      const label = await ctx.db
        .query("todoist_labels")
        .withIndex("by_name", (q) => q.eq("name", labelName))
        .unique()
      return { name: labelName, color: label?.color ?? "charcoal" }
    }),
  )

  return {
    ...run,
    entity_title: task?.content ?? "(missing)",
    description: task?.description ?? null,
    priority: task?.priority ?? null,
    due: task?.due?.date ?? null,
    deadline: task?.deadline?.date ?? null,
    labels,
    project,
    checked: task?.checked ?? false,
  }
}
