import type { FunctionReturnType } from "convex/server"

import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"

export type TodoistProject = FunctionReturnType<typeof api.todoist.publicQueries.getProjects>[number]
export type TodoistTask = FunctionReturnType<typeof api.todoist.publicQueries.getItemsByView>[number]

export type TodoistTaskDoc = Doc<"todoist_items">
export type TodoistProjectDoc = Doc<"todoist_projects">
export type TodoistLabelDoc = Doc<"todoist_labels">
