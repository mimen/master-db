export type ViewConfig = {
  id: string
  type: "inbox" | "today" | "upcoming" | "project" | "time" | "priority" | "label"
  value: string
  title?: string
  collapsible?: boolean
  expanded?: boolean
}

export type ViewChangeAction =
  | { type: "set", views: ViewConfig[] }
  | { type: "add", view: ViewConfig }
  | { type: "remove", id: string }
  | { type: "toggle", id: string }
  | { type: "replace", view: ViewConfig }
