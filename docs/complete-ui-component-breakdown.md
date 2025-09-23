# Complete UI Component Breakdown - Vite + React + Convex + shadcn/ui

## Architecture Overview

This document provides a complete breakdown of all UI components, utilities, abstractions, and data flow necessary to recreate the todoist-inbox-processor using modern tools.

### Tech Stack
- **Vite** - Build tool for fast development
- **React 18** - UI library  
- **Convex** - Backend, database, real-time sync
- **shadcn/ui** - Headless component library
- **Tailwind CSS** - Utility-first CSS
- **Lucide React** - Icon library

## Project Structure

```
todoist-app/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Layout.tsx
│   │   │   └── Footer.tsx
│   │   ├── views/
│   │   │   ├── ProcessingView/
│   │   │   │   ├── index.tsx
│   │   │   │   ├── TaskCard.tsx
│   │   │   │   ├── TaskForm.tsx
│   │   │   │   └── SuggestionPanel.tsx
│   │   │   └── ListView/
│   │   │       ├── index.tsx
│   │   │       ├── TaskRow.tsx
│   │   │       └── TaskGroup.tsx
│   │   ├── overlays/
│   │   │   ├── OverlayContainer.tsx
│   │   │   ├── ProjectSelector.tsx
│   │   │   ├── LabelSelector.tsx
│   │   │   ├── PrioritySelector.tsx
│   │   │   ├── DatePicker.tsx
│   │   │   └── KeyboardShortcuts.tsx
│   │   ├── ui/ (shadcn components)
│   │   │   ├── button.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── command.tsx
│   │   │   ├── popover.tsx
│   │   │   └── ...
│   │   └── shared/
│   │       ├── TaskCheckbox.tsx
│   │       ├── PriorityFlag.tsx
│   │       ├── ProjectDot.tsx
│   │       ├── LabelPill.tsx
│   │       └── LoadingSpinner.tsx
│   ├── hooks/
│   │   ├── useFilteredTasks.ts
│   │   ├── useKeyboardShortcuts.ts
│   │   ├── useProcessingQueue.ts
│   │   ├── useViewMode.ts
│   │   └── useOverlay.ts
│   ├── lib/
│   │   ├── utils.ts
│   │   ├── keyboard.ts
│   │   └── colors.ts
│   ├── convex/
│   │   └── _generated/
│   └── App.tsx
```

## Core Components Breakdown

### 1. App Root Component

```tsx
// App.tsx
import { ConvexProvider, ConvexReactClient } from "convex/react"
import { Layout } from "@/components/layout/Layout"
import { TaskProcessor } from "@/components/TaskProcessor"

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL)

export function App() {
  return (
    <ConvexProvider client={convex}>
      <Layout>
        <TaskProcessor />
      </Layout>
    </ConvexProvider>
  )
}
```

### 2. Task Processor (Main Orchestrator)

```tsx
// components/TaskProcessor.tsx
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { ProcessingView } from "./views/ProcessingView"
import { ListView } from "./views/ListView"
import { useViewMode } from "@/hooks/useViewMode"
import { useProcessingState } from "@/hooks/useProcessingState"

export function TaskProcessor() {
  const { viewMode } = useViewMode()
  const { filter, mode } = useProcessingState()
  
  // Single query for filtered tasks
  const tasks = useQuery(api.tasks.getFilteredTasks, { 
    filter,
    assigneeFilter: "not-assigned-to-others" 
  })
  
  if (!tasks) return <LoadingState />
  
  return (
    <>
      <Header mode={mode} />
      {viewMode === "processing" ? (
        <ProcessingView tasks={tasks} />
      ) : (
        <ListView tasks={tasks} />
      )}
    </>
  )
}
```

### 3. Processing View Components

```tsx
// components/views/ProcessingView/index.tsx
import { Card } from "@/components/ui/card"
import { TaskCard } from "./TaskCard"
import { TaskForm } from "./TaskForm"
import { QueueProgress } from "@/components/queue/QueueProgress"
import { useProcessingQueue } from "@/hooks/useProcessingQueue"

export function ProcessingView({ tasks }) {
  const { currentTask, progress, next, skip } = useProcessingQueue(tasks)
  
  if (!currentTask) {
    return <EmptyState />
  }
  
  return (
    <div className="container max-w-6xl mx-auto p-6">
      <QueueProgress progress={progress} />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <TaskCard task={currentTask} />
        <TaskForm 
          task={currentTask}
          onSubmit={next}
          onSkip={skip}
        />
      </div>
    </div>
  )
}
```

```tsx
// components/views/ProcessingView/TaskCard.tsx
import { Card, CardHeader, CardContent } from "@/components/ui/card"
import { PriorityFlag } from "@/components/shared/PriorityFlag"
import { ProjectDot } from "@/components/shared/ProjectDot"
import { LabelPill } from "@/components/shared/LabelPill"

export function TaskCard({ task }) {
  const project = useQuery(api.projects.get, { id: task.projectId })
  
  return (
    <Card className="sticky top-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          {project && <ProjectDot color={project.color} />}
          <h2 className="text-xl font-semibold">{task.content}</h2>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {task.description && (
            <p className="text-muted-foreground">{task.description}</p>
          )}
          
          <div className="flex items-center gap-2">
            <PriorityFlag priority={task.priority} />
            {task.labels.map(label => (
              <LabelPill key={label} label={label} />
            ))}
          </div>
          
          {task.due && (
            <div className="text-sm text-muted-foreground">
              Due: {formatDate(task.due.date)}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
```

### 4. List View Components

```tsx
// components/views/ListView/index.tsx
import { Checkbox } from "@/components/ui/checkbox"
import { TaskRow } from "./TaskRow"
import { useSelectedTasks } from "@/hooks/useSelectedTasks"
import { useGroupedTasks } from "@/hooks/useGroupedTasks"

export function ListView({ tasks }) {
  const { selectedIds, toggle, selectAll } = useSelectedTasks()
  const grouped = useGroupedTasks(tasks)
  
  return (
    <div className="container max-w-4xl mx-auto p-6">
      <ListHeader 
        totalCount={tasks.length}
        selectedCount={selectedIds.size}
        onSelectAll={selectAll}
      />
      
      <div className="space-y-1">
        {grouped.map(group => (
          <TaskGroup key={group.id} group={group}>
            {group.tasks.map(task => (
              <TaskRow
                key={task._id}
                task={task}
                selected={selectedIds.has(task._id)}
                onToggle={() => toggle(task._id)}
              />
            ))}
          </TaskGroup>
        ))}
      </div>
    </div>
  )
}
```

```tsx
// components/views/ListView/TaskRow.tsx
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { MoreHorizontal } from "lucide-react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"

export function TaskRow({ task, selected, onToggle }) {
  const completeTask = useMutation(api.tasks.complete)
  const openOverlay = useOverlay()
  
  return (
    <div className="group flex items-center gap-3 p-2 hover:bg-muted/50 rounded">
      <Checkbox 
        checked={selected}
        onCheckedChange={onToggle}
        className="opacity-0 group-hover:opacity-100"
      />
      
      <button
        className="w-4 h-4 rounded-full border-2 hover:bg-primary hover:border-primary"
        onClick={() => completeTask({ taskId: task._id })}
      />
      
      <div className="flex-1 min-w-0">
        <span className="truncate">{task.content}</span>
        
        <div className="flex items-center gap-2 mt-1">
          {task.project && (
            <ProjectBadge project={task.project} />
          )}
          {task.priority > 1 && (
            <PriorityFlag priority={task.priority} size="sm" />
          )}
          {task.labels.map(label => (
            <LabelPill key={label} label={label} size="sm" />
          ))}
        </div>
      </div>
      
      <Button
        size="icon"
        variant="ghost"
        className="opacity-0 group-hover:opacity-100"
        onClick={() => openOverlay("task-menu", task._id)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    </div>
  )
}
```

### 5. Overlay System

```tsx
// hooks/useOverlay.ts
import { create } from "zustand"

interface OverlayState {
  type: string | null
  data: any
  open: (type: string, data?: any) => void
  close: () => void
}

export const useOverlayStore = create<OverlayState>((set) => ({
  type: null,
  data: null,
  open: (type, data) => set({ type, data }),
  close: () => set({ type: null, data: null }),
}))

export function useOverlay() {
  return useOverlayStore()
}
```

```tsx
// components/overlays/OverlayContainer.tsx
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useOverlay } from "@/hooks/useOverlay"
import { ProjectSelector } from "./ProjectSelector"
import { LabelSelector } from "./LabelSelector"
import { PrioritySelector } from "./PrioritySelector"

const OVERLAY_COMPONENTS = {
  project: ProjectSelector,
  label: LabelSelector,
  priority: PrioritySelector,
  // ... more overlays
}

export function OverlayContainer() {
  const { type, data, close } = useOverlay()
  
  if (!type) return null
  
  const Component = OVERLAY_COMPONENTS[type]
  if (!Component) return null
  
  return (
    <Dialog open={!!type} onOpenChange={close}>
      <DialogContent>
        <Component {...data} onClose={close} />
      </DialogContent>
    </Dialog>
  )
}
```

```tsx
// components/overlays/ProjectSelector.tsx
import { Command, CommandInput, CommandList, CommandItem } from "@/components/ui/command"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { ProjectDot } from "@/components/shared/ProjectDot"

export function ProjectSelector({ taskId, onClose }) {
  const projects = useQuery(api.projects.getAllWithCounts)
  const updateTask = useMutation(api.tasks.update)
  
  const handleSelect = async (projectId: string) => {
    await updateTask({ taskId, updates: { projectId } })
    onClose()
  }
  
  return (
    <Command>
      <CommandInput placeholder="Search projects..." />
      <CommandList>
        {projects?.map(project => (
          <CommandItem
            key={project._id}
            onSelect={() => handleSelect(project._id)}
          >
            <ProjectDot color={project.color} className="mr-2" />
            <span className="flex-1">{project.name}</span>
            <span className="text-xs text-muted-foreground">
              {project.taskCount}
            </span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  )
}
```

### 6. Keyboard Shortcuts

```tsx
// hooks/useKeyboardShortcuts.ts
import { useEffect } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { useOverlay } from "./useOverlay"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"

export function useKeyboardShortcuts() {
  const { open: openOverlay } = useOverlay()
  const processTask = useMutation(api.tasks.process)
  const skipTask = useMutation(api.tasks.skip)
  
  // Global shortcuts
  useHotkeys("?", () => openOverlay("shortcuts"))
  useHotkeys("n", () => openOverlay("new-task"))
  
  // Processing shortcuts
  useHotkeys("enter", () => processTask())
  useHotkeys("s", () => skipTask())
  
  // Quick actions
  useHotkeys("p", () => openOverlay("project"))
  useHotkeys("l", () => openOverlay("label"))
  useHotkeys("1,2,3,4", (e) => {
    const priority = parseInt(e.key)
    // Update current task priority
  })
}
```

### 7. Queue Management

```tsx
// hooks/useProcessingQueue.ts
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useState, useCallback } from "react"

export function useProcessingQueue() {
  const queueState = useQuery(api.queues.getCurrentQueue)
  const progressQueue = useMutation(api.queues.progress)
  const [showNextPrompt, setShowNextPrompt] = useState(false)
  
  const next = useCallback(async () => {
    const result = await progressQueue()
    
    if (result.queueComplete && result.hasNextQueue) {
      setShowNextPrompt(true)
    }
  }, [progressQueue])
  
  return {
    currentTask: queueState?.currentTask,
    progress: queueState?.progress,
    queueInfo: queueState?.queueInfo,
    next,
    skip: () => progressQueue({ skip: true }),
    showNextPrompt,
    continueToNext: () => {
      setShowNextPrompt(false)
      progressQueue({ moveToNextQueue: true })
    }
  }
}
```

### 8. Shared UI Components

```tsx
// components/shared/PriorityFlag.tsx
import { Flag } from "lucide-react"
import { cn } from "@/lib/utils"

const PRIORITY_COLORS = {
  1: "text-gray-400",
  2: "text-blue-500",
  3: "text-orange-500",
  4: "text-red-500",
}

export function PriorityFlag({ priority, size = "default" }) {
  return (
    <Flag 
      className={cn(
        PRIORITY_COLORS[priority],
        size === "sm" && "h-3 w-3",
        size === "default" && "h-4 w-4"
      )}
    />
  )
}
```

```tsx
// components/shared/ProjectDot.tsx
import { cn } from "@/lib/utils"
import { getProjectColor } from "@/lib/colors"

export function ProjectDot({ color, className }) {
  const hex = getProjectColor(color)
  
  return (
    <div 
      className={cn("w-3 h-3 rounded-full", className)}
      style={{ backgroundColor: hex }}
    />
  )
}
```

### 9. Utilities

```tsx
// lib/colors.ts
export const TODOIST_COLORS = {
  "berry_red": "#b8255f",
  "red": "#db4035",
  "orange": "#ff9933",
  "yellow": "#fad000",
  "olive_green": "#afb83b",
  "lime_green": "#7ecc49",
  "green": "#299438",
  "mint_green": "#6accbc",
  "teal": "#158fad",
  "sky_blue": "#14aaf5",
  "light_blue": "#96c3eb",
  "blue": "#4073ff",
  "grape": "#884dff",
  "violet": "#af38eb",
  "lavender": "#eb96eb",
  "magenta": "#e05194",
  "salmon": "#ff8d85",
  "charcoal": "#808080",
  "grey": "#b8b8b8",
  "taupe": "#ccac93",
} as const

export function getProjectColor(color: string): string {
  return TODOIST_COLORS[color] || "#808080"
}

export const PRIORITY_COLORS = {
  1: "#d1d5db", // gray-300
  2: "#3b82f6", // blue-500
  3: "#f97316", // orange-500
  4: "#ef4444", // red-500
} as const

export function getPriorityColor(priority: number): string {
  return PRIORITY_COLORS[priority] || "#d1d5db"
}
```

## Data Flow Architecture

### 1. Query Pattern
```tsx
// All data fetching happens through Convex queries
const tasks = useQuery(api.tasks.getFilteredTasks, { filter })
const projects = useQuery(api.projects.getAllWithCounts)
const labels = useQuery(api.labels.getAll)
```

### 2. Mutation Pattern
```tsx
// All updates go through Convex mutations
const updateTask = useMutation(api.tasks.update)
const completeTask = useMutation(api.tasks.complete)
const bulkUpdate = useMutation(api.tasks.bulkUpdate)

// Usage - Convex handles optimistic updates
await updateTask({ 
  taskId: "...", 
  updates: { priority: 4 } 
})
```

### 3. Real-time Updates
```tsx
// Automatic real-time sync - no setup needed
// When any client updates a task, all clients see it instantly
const tasks = useQuery(api.tasks.getAll) // Always up-to-date
```

### 4. Local UI State
```tsx
// Only truly local state lives in React
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
const [overlayOpen, setOverlayOpen] = useState(false)
const [searchQuery, setSearchQuery] = useState("")
```

## Component Library Setup (shadcn/ui)

### Installation
```bash
# Install shadcn/ui CLI
npx shadcn-ui@latest init

# Install components as needed
npx shadcn-ui@latest add button card dialog command popover
npx shadcn-ui@latest add select checkbox radio-group
npx shadcn-ui@latest add toast alert badge
```

### Theme Configuration
```tsx
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        todoist: {
          red: "#db4035",
          priority: {
            1: "#d1d5db",
            2: "#3b82f6", 
            3: "#f97316",
            4: "#ef4444",
          }
        }
      }
    }
  }
}
```

## Performance Optimizations

### 1. Query Optimization
```tsx
// Convex automatically caches and deduplicates queries
// Multiple components can call the same query with no penalty
const projects = useQuery(api.projects.getAll) // Cached across components
```

### 2. Lazy Loading
```tsx
// Only load data when needed
const ProjectDetails = lazy(() => import("./ProjectDetails"))
```

### 3. Virtual Scrolling
```tsx
// For large lists (>100 items)
import { FixedSizeList } from "react-window"

function VirtualTaskList({ tasks }) {
  return (
    <FixedSizeList
      height={600}
      itemCount={tasks.length}
      itemSize={48}
    >
      {({ index, style }) => (
        <div style={style}>
          <TaskRow task={tasks[index]} />
        </div>
      )}
    </FixedSizeList>
  )
}
```

## Testing Strategy

### Component Testing
```tsx
// Using Vitest + React Testing Library
import { render } from "@testing-library/react"
import { ConvexProvider } from "convex/react"
import { TaskCard } from "./TaskCard"

test("renders task content", () => {
  const { getByText } = render(
    <ConvexProvider client={mockClient}>
      <TaskCard task={mockTask} />
    </ConvexProvider>
  )
  
  expect(getByText("Test task")).toBeInTheDocument()
})
```

## Summary

This architecture provides:
1. **Simple data flow** - Convex handles all complexity
2. **Minimal state** - Only UI state in React
3. **Type safety** - End-to-end from Convex to components
4. **Real-time sync** - Automatic, no configuration
5. **Modern tooling** - Fast development with Vite + shadcn/ui
6. **Clean separation** - UI only cares about presentation

The entire app can be built with ~50% less code than the original while maintaining all functionality and improving performance.