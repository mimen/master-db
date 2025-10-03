import { useState } from "react"

import { TaskListView } from "../TaskListView"
import type { ViewConfig } from "@/types/views"

import { Sidebar } from "./Sidebar"

export function Layout() {
  const [activeViews, setActiveViews] = useState<ViewConfig[]>([
    { id: "main", type: "inbox", value: "inbox", expanded: true, collapsible: false }
  ])

  const handleViewChange = (view: string) => {
    setActiveViews([
      { id: "main", type: getViewType(view), value: view, expanded: true, collapsible: false }
    ])
  }

  const handleMultiViewChange = (views: ViewConfig[]) => {
    setActiveViews(views)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-xl font-semibold">Todoist Processor</h1>
        </div>
      </header>
      <div className="flex h-[calc(100vh-73px)]">
        <Sidebar 
          currentView={activeViews[0]?.value || "inbox"}
          onViewChange={handleViewChange}
          onMultiViewChange={handleMultiViewChange}
        />
        <main className="flex-1 overflow-auto">
          <div className="space-y-6">
            {activeViews.map((view) => (
              <TaskListView key={view.id} viewConfig={view} />
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}

function getViewType(view: string): ViewConfig["type"] {
  if (view === "inbox") return "inbox"
  if (view === "today") return "today"
  if (view === "upcoming") return "upcoming"
  if (view.startsWith("project:")) return "project"
  if (view.startsWith("time:")) return "time"
  if (view.startsWith("priority:")) return "priority"
  if (view.startsWith("label:")) return "label"
  return "inbox"
}