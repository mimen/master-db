import { useState } from "react"

import { TaskListView } from "../TaskListView"

import { Sidebar } from "./Sidebar"

export function Layout() {
  const [currentView, setCurrentView] = useState("inbox")

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-xl font-semibold">Todoist Processor</h1>
        </div>
      </header>
      <div className="flex h-[calc(100vh-73px)]">
        <Sidebar currentView={currentView} onViewChange={setCurrentView} />
        <main className="flex-1 overflow-auto">
          <TaskListView currentView={currentView} />
        </main>
      </div>
    </div>
  )
}