import type { ReactNode } from "react"

import type { TodoistLabelDoc, TodoistProjects, TodoistProjectsWithMetadata } from "@/types/convex/todoist"

export type TimeRange = "overdue" | "today" | "upcoming" | "no-date"

export type ListQueryDefinition =
  | { type: "inbox"; inboxProjectId?: string; timezoneOffsetMinutes?: number }
  | { type: "time"; range: TimeRange; timezoneOffsetMinutes?: number }
  | { type: "project"; projectId: string; timezoneOffsetMinutes?: number }
  | { type: "priority"; priority: 1 | 2 | 3 | 4; timezoneOffsetMinutes?: number }
  | { type: "label"; label: string; timezoneOffsetMinutes?: number }

export type ListQueryInput = ListQueryDefinition & { view: ViewKey }

export type ListDependencies = {
  projects?: boolean
  projectMetadata?: boolean
  labels?: boolean
}

export interface ListSupportData {
  projects?: TodoistProjects
  projectsWithMetadata?: TodoistProjectsWithMetadata
  labels?: TodoistLabelDoc[]
}

export interface ListPresentationContext<P extends Record<string, unknown> = Record<string, never>> {
  params: P
  taskCount: number
  support: ListSupportData
}

export interface ListHeaderInfo {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
}

export interface ListEmptyStateInfo {
  title: ReactNode
  description?: ReactNode
}

export interface ListDefinition<P extends Record<string, unknown> = Record<string, never>> {
  key: string
  defaults: {
    collapsible: boolean
    startExpanded: boolean
    maxTasks?: number
  }
  dependencies?: ListDependencies
  buildQuery: (params: P) => ListQueryDefinition
  getHeader: (context: ListPresentationContext<P>) => ListHeaderInfo
  getEmptyState: (context: ListPresentationContext<P>) => ListEmptyStateInfo
}

export type ListInstanceOverrides<P extends Record<string, unknown> = Record<string, never>> = {
  collapsible?: boolean
  startExpanded?: boolean
  maxTasks?: number
  getHeader?: (context: ListPresentationContext<P>) => ListHeaderInfo
  getEmptyState?: (context: ListPresentationContext<P>) => ListEmptyStateInfo
}

export interface ListInstance<P extends Record<string, unknown> = Record<string, never>> {
  id: string
  viewKey: string
  indexInView: number
  definition: ListDefinition<P>
  params: P
  query: ListQueryInput
  collapsible: boolean
  startExpanded: boolean
  maxTasks?: number
  dependencies: ListDependencies
  getHeader: (context: ListPresentationContext<P>) => ListHeaderInfo
  getEmptyState: (context: ListPresentationContext<P>) => ListEmptyStateInfo
}

export interface ListInstanceOptions<P extends Record<string, unknown> = Record<string, never>> {
  id: string
  viewKey: string
  indexInView: number
  params: P
  overrides?: ListInstanceOverrides<P>
}

export type ViewKey =
  | "view:inbox"
  | "view:today"
  | "view:upcoming"
  | "view:priority-queue"
  | "view:settings"
  | `view:time:${TimeRange}`
  | `view:project:${string}`
  | `view:project-family:${string}`
  | `view:priority:${"p1" | "p2" | "p3" | "p4"}`
  | `view:priority-projects:${"p1" | "p2" | "p3" | "p4"}`
  | `view:label:${string}`
  | `view:multi:${string}`

export interface ViewMetadata {
  title: string
  icon?: ReactNode
  description?: string
}

export interface ViewSelection {
  key: ViewKey
  metadata: ViewMetadata
  lists: ListInstance[]
}

export interface ViewBuildContext {
  projects?: TodoistProjects
  projectsWithMetadata?: TodoistProjectsWithMetadata
  labels?: TodoistLabelDoc[]
}
