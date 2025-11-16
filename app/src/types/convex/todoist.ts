import type { FunctionReturnType } from "convex/server"

import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"

export type TodoistProjects = FunctionReturnType<typeof api.todoist.queries.getProjects.getProjects>
export type TodoistProject = TodoistProjects[number]

export type TodoistItemsByList = FunctionReturnType<typeof api.todoist.queries.getItemsByView.getItemsByView>
export type TodoistTask = TodoistItemsByList[number]

export type TodoistItemsByListWithProjects = FunctionReturnType<typeof api.todoist.queries.getItemsByViewWithProjects.getItemsByViewWithProjects>
export type TodoistTaskWithProject = TodoistItemsByListWithProjects[number]

export type TodoistProjectsWithMetadata = FunctionReturnType<typeof api.todoist.computed.queries.getProjectsWithMetadata.getProjectsWithMetadata>
export type TodoistProjectWithMetadata = TodoistProjectsWithMetadata[number]

export type TodoistActiveItems = FunctionReturnType<typeof api.todoist.queries.getActiveItems.getActiveItems>
export type TodoistActiveItem = TodoistActiveItems[number]

export type TodoistSyncStatus = FunctionReturnType<typeof api.todoist.queries.getSyncStatus.getSyncStatus>

export type TodoistTaskDoc = Doc<"todoist_items">
export type TodoistProjectDoc = Doc<"todoist_projects">
export type TodoistLabelDoc = Doc<"todoist_labels">
