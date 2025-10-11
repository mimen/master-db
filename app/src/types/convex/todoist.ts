import type { FunctionReturnType } from "convex/server"

import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"

export type TodoistProjects = FunctionReturnType<typeof api.todoist.publicQueries.getProjects>
export type TodoistProject = TodoistProjects[number]

export type TodoistItemsByList = FunctionReturnType<typeof api.todoist.publicQueries.getItemsByView>
export type TodoistTask = TodoistItemsByList[number]

export type TodoistItemsByListWithProjects = FunctionReturnType<typeof api.todoist.publicQueries.getItemsByViewWithProjects>
export type TodoistTaskWithProject = TodoistItemsByListWithProjects[number]

export type TodoistProjectsWithMetadata = FunctionReturnType<typeof api.todoist.publicQueries.getProjectsWithMetadata>
export type TodoistProjectWithMetadata = TodoistProjectsWithMetadata[number]

export type TodoistActiveItems = FunctionReturnType<typeof api.todoist.queries.getActiveItems>
export type TodoistActiveItem = TodoistActiveItems[number]

export type TodoistSyncStatus = FunctionReturnType<typeof api.todoist.queries.getSyncStatus>

export type TodoistTaskDoc = Doc<"todoist_items">
export type TodoistProjectDoc = Doc<"todoist_projects">
export type TodoistLabelDoc = Doc<"todoist_labels">
