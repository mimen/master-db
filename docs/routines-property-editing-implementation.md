# Routines Property Editing Enhancement

**Project**: Standardize RoutineRow + Add Editable Todoist Properties
**Owner**: Milad
**Started**: 2025-11-15
**Status**: Planning Complete
**Parent**: routines-system-implementation.md

---

## 🎯 Project Overview

### Goal

Standardize RoutineRow to match the established TaskRow/ProjectRow component pattern, then add support for editing Todoist properties (priority, project, labels) directly on routine list items with keyboard shortcuts and optimistic UI updates.

### Motivation

1. **Inconsistent UI Pattern**: RoutineRow currently diverges from the standard list item pattern used by TaskRow and ProjectRow
2. **Missing Property Editing**: Users can't edit Todoist properties on routines without opening the full dialog
3. **No Keyboard Shortcuts**: Routine items don't support the same quick-edit keyboard shortcuts as tasks/projects

### Success Criteria

- [ ] RoutineRow matches TaskRow/ProjectRow structure (focus management, hover states, badge layout)
- [ ] Can edit priority via badge click or 'p' keyboard shortcut
- [ ] Can edit project via badge click or '#' keyboard shortcut
- [ ] Can edit labels via badge click or '@' keyboard shortcut
- [ ] Optimistic UI updates provide instant feedback
- [ ] Changes sync correctly to Convex database
- [ ] All validation passes: `bun run typecheck && bun run lint && bun test`

---

## 📊 Current State Analysis

### RoutineRow vs Standard Pattern

**Current RoutineRow** (`app/src/components/RoutineRow.tsx`):
```tsx
<div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-accent">
  <Repeat icon />
  <div className="flex-1">
    <div className="flex items-center gap-2">
      <span>{name}</span>
      <Badge>{frequency}</Badge>
      {defer && <Badge>Paused</Badge>}
    </div>
    {description && <div>{description}</div>}
  </div>
  <div className="flex gap-2">
    <div>{stats}</div>
    <Button>{defer toggle}</Button>
  </div>
</div>
```

**Standard Pattern** (from TaskRow/ProjectRow):
```tsx
<div
  ref={onElementRef}
  tabIndex={-1}
  aria-selected={false}
  data-entity-id={id}
  className="group border border-transparent p-2.5 rounded-md focus:bg-accent/50..."
  onMouseEnter={() => setIsHovered(true)}
  onMouseLeave={() => setIsHovered(false)}
>
  <div className="flex items-start gap-2.5">
    <Icon className="mt-0.5" />
    <div className="flex-1 min-w-0 space-y-1.5">
      <div onClick={(e) => e.stopPropagation()}>
        {content}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {badges}
      </div>
    </div>
  </div>
</div>
```

**Key Differences**:
| Feature | RoutineRow | Standard Pattern |
|---------|-----------|------------------|
| Layout alignment | `items-center` | `items-start` |
| Focusable | ❌ No tabIndex | ✅ `tabIndex={-1}` |
| Hover state | ❌ No state | ✅ `isHovered` state |
| Badge layout | Inline with name | Separate container below |
| Padding | `px-4 py-2.5` | `p-2.5` |
| Border | None | `border border-transparent` |
| Focus styling | ❌ None | ✅ CSS classes applied |
| Data attribute | ❌ None | ✅ `data-entity-id` |
| Accessibility | ❌ No `aria-selected` | ✅ `aria-selected={false}` |

### Focus Management Patterns

**RoutinesListView** (current):
```typescript
// Map-based refs
const routineRefs = useRef<Map<string, HTMLDivElement>>(new Map())

// Only scrolls into view
useEffect(() => {
  const element = routineRefs.current.get(focusedRoutine._id)
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }
}, [focusedRoutine])
```

**TaskListView** (standard):
```typescript
// Array-based refs with stable handlers
const refs = useRef<(HTMLDivElement | null)[]>([])
const refHandlers = useRef<((element: HTMLDivElement | null) => void)[]>([])
const lastFocusedIndex = useRef<number | null>(null)

// Applies CSS classes + scrolls
useEffect(() => {
  const FOCUSED_CLASSNAMES = ["bg-accent/50", "border-primary/30"]

  // Remove from old
  if (lastFocusedIndex.current !== null) {
    const oldElement = refs.current[lastFocusedIndex.current]
    if (oldElement) {
      FOCUSED_CLASSNAMES.forEach(cls => oldElement.classList.remove(cls))
    }
  }

  // Add to new
  if (focusedIndex >= 0) {
    const newElement = refs.current[focusedIndex]
    if (newElement) {
      FOCUSED_CLASSNAMES.forEach(cls => newElement.classList.add(cls))
      newElement.scrollIntoView({ behavior: "smooth", block: "nearest" })
      lastFocusedIndex.current = focusedIndex
    }
  }
}, [focusedIndex])
```

### Routine Data Schema

**Available Todoist Properties** (`convex/schema/routines/routines.ts`):
```typescript
{
  todoistProjectId?: string,  // Where to create tasks
  todoistLabels: string[],    // Additional labels beyond "routine"
  priority: number,           // 1-4 (same as Todoist API)
}
```

**Semantic Differences from Tasks**:
- **Priority**: What priority generated tasks will have (not current state)
- **Project**: Where to create tasks (not where routine "belongs")
- **Labels**: Additive to automatic "routine" label (not full list)

### Existing Infrastructure

**Dialog System**:
- `PriorityDialog`: ✅ **Already generic!** Accepts `task | project`
- `ProjectDialog`: ❌ Task-specific, needs generalization
- `LabelDialog`: ❌ Task-specific, needs generalization

**Optimistic Updates**:
- Currently supports tasks and projects
- Uses `createOptimisticHook` factory pattern
- Context-based state management

**Keyboard Shortcuts**:
- `useTaskDialogShortcuts`: Hooks for tasks only
- Keys: `p` (priority), `#` (project), `@` (labels)
- Need routine equivalent

**Focus Context** (`app/src/contexts/FocusContext.tsx`):
```typescript
interface FocusContextValue {
  focusedTask: TodoistTask | null
  focusedProject: TodoistProjectWithMetadata | null
  // Missing: focusedRoutine
}
```

---

## 🏗️ Architecture Design

### Component Hierarchy

```
RoutinesListView
├── Focus Management (array-based refs)
├── FocusContext Integration
└── RoutineRow (standardized)
    ├── Container (focusable, hoverable)
    ├── Icon (Repeat with mt-0.5)
    ├── Content Area
    │   ├── Name/Description (editing area)
    │   └── Badge Container
    │       ├── Frequency Badge
    │       ├── Defer Badge
    │       ├── Priority Badge (new)
    │       ├── Project Badge (new)
    │       ├── Label Badges (new)
    │       └── Ghost Badges (on hover)
    └── Stats Section (completion rate, duration)
```

### Data Flow

```
User Action (badge click or keyboard shortcut)
  ↓
DialogContext.openDialog(routine)
  ↓
Dialog Opens
  ↓
User Selects New Value
  ↓
Optimistic Hook.mutate(routineId, newValue)
  ↓
OptimisticUpdatesContext.addRoutineUpdate()  ←  Immediate UI update
  ↓
Convex Action: api.routines.actions.updateRoutine
  ↓
Database Update
  ↓
React Query Refetch
  ↓
Component Re-renders with DB Data
  ↓
useEffect Clears Optimistic Update (values match)
```

### Optimistic Updates Architecture

```typescript
// Context State
{
  taskUpdates: Map<string, OptimisticTaskUpdate>,
  projectUpdates: Map<string, OptimisticProjectUpdate>,
  routineUpdates: Map<string, OptimisticRoutineUpdate>  // ← New
}

// Update Types
type OptimisticRoutineUpdate =
  | { routineId: string; type: "priority-change"; newPriority: number; timestamp: number }
  | { routineId: string; type: "project-change"; newProjectId: string; timestamp: number }
  | { routineId: string; type: "label-change"; newLabels: string[]; timestamp: number }

// Hooks
useOptimisticRoutinePriority(routineId, newPriority)
useOptimisticRoutineProject(routineId, newProjectId)
useOptimisticRoutineLabels(routineId, newLabels)

// Component Usage
const optimisticUpdate = getRoutineUpdate(routine._id)
const effectivePriority = optimisticUpdate?.type === "priority-change"
  ? optimisticUpdate.newPriority
  : routine.priority
```

---

## 📋 Implementation Plan

### Phase 1: Standardize RoutineRow Structure ⏳

**Goal**: Align RoutineRow with TaskRow/ProjectRow pattern

#### 1.1 Container Refactoring

**File**: `app/src/components/RoutineRow.tsx`

**Changes**:
- [ ] Add `const [isHovered, setIsHovered] = useState(false)`
- [ ] Add to container div:
  - `tabIndex={-1}`
  - `aria-selected={false}`
  - `data-routine-id={routine._id}`
  - `onMouseEnter={() => setIsHovered(true)}`
  - `onMouseLeave={() => setIsHovered(false)}`
- [ ] Update className:
  - Change `items-center` → `items-start`
  - Change `px-4 py-2.5` → `p-2.5`
  - Add `rounded-md border border-transparent`
  - Change `hover:bg-accent` → `hover:bg-accent/50`
  - Add `transition-all duration-150`
  - Add `focus:outline-none focus:bg-accent/50 focus:border-primary/30`

#### 1.2 Content Layout Restructuring

**Changes**:
- [ ] Add `mt-0.5` to Repeat icon for top-alignment
- [ ] Update main content div: add `space-y-1.5` className
- [ ] Wrap name/description in `<div onClick={(e) => e.stopPropagation()}>`
- [ ] Create separate badge container below content:
  ```tsx
  <div className="flex flex-wrap items-center gap-1">
    {/* All badges here */}
  </div>
  ```
- [ ] Move frequency badge to badge container
- [ ] Move defer/paused badge to badge container

**Decision Points**:
- ❓ Completion rate: Keep as right-side stat or move to badge?
  - **Recommendation**: Keep as stat (routine-specific, not Todoist property)
- ❓ Defer toggle: Keep on right or move to hover badge?
  - **Recommendation**: Keep on right (primary action, should be visible)

#### 1.3 Focus Management in RoutinesListView

**File**: `app/src/components/RoutinesListView.tsx`

**Changes**:
- [ ] Replace Map-based refs with array-based:
  ```typescript
  const routineRefs = useRef<(HTMLDivElement | null)[]>([])
  const refHandlers = useRef<((element: HTMLDivElement | null) => void)[]>([])
  const lastFocusedIndex = useRef<number | null>(null)
  ```
- [ ] Create stable ref handlers:
  ```typescript
  if (!refHandlers.current[index]) {
    refHandlers.current[index] = (element) => {
      routineRefs.current[index] = element
      if (element === null && lastFocusedIndex.current === index) {
        lastFocusedIndex.current = null
      }
    }
  }
  ```
- [ ] Add focus styling constant:
  ```typescript
  const ROUTINE_ROW_FOCUSED_CLASSNAMES = ["bg-accent/50", "border-primary/30"]
  ```
- [ ] Implement focus styling useEffect (following TaskListView pattern)

#### 1.4 FocusContext Integration

**File**: `app/src/contexts/FocusContext.tsx`

**Changes**:
- [ ] Add to interface:
  ```typescript
  focusedRoutine: Doc<"routines"> | null
  setFocusedRoutine: (routine: Doc<"routines"> | null) => void
  ```
- [ ] Add state: `const [focusedRoutine, setFocusedRoutine] = useState<Doc<"routines"> | null>(null)`
- [ ] Add to context value

**File**: `app/src/components/RoutinesListView.tsx`

**Changes**:
- [ ] Import `useFocusContext`
- [ ] Call `setFocusedRoutine` when focus changes:
  ```typescript
  useEffect(() => {
    setFocusedRoutine(focusedRoutine)
    return () => setFocusedRoutine(null)
  }, [focusedRoutine, setFocusedRoutine])
  ```

**Testing**:
- [ ] Verify RoutineRow matches TaskRow visual style
- [ ] Test keyboard navigation focuses correct row
- [ ] Test focus styling applies correctly
- [ ] Verify hover states work

---

### Phase 2: Optimistic Updates Infrastructure ⏳

**Goal**: Add routine support to optimistic updates system

#### 2.1 Extend OptimisticUpdatesContext

**File**: `app/src/lib/optimistic/OptimisticUpdatesContext.tsx`

**Changes**:
- [ ] Add type definition:
  ```typescript
  export type OptimisticRoutineUpdate =
    | { routineId: string; type: "priority-change"; newPriority: number; timestamp: number }
    | { routineId: string; type: "project-change"; newProjectId: string; timestamp: number }
    | { routineId: string; type: "label-change"; newLabels: string[]; timestamp: number }
  ```
- [ ] Add state:
  ```typescript
  const [routineUpdates, setRoutineUpdates] = useState<Map<string, OptimisticRoutineUpdate>>(new Map())
  ```
- [ ] Add functions:
  ```typescript
  const addRoutineUpdate = (routineId: string, update: OptimisticRoutineUpdate) => {
    setRoutineUpdates(prev => new Map(prev).set(routineId, update))
  }

  const removeRoutineUpdate = (routineId: string) => {
    setRoutineUpdates(prev => {
      const next = new Map(prev)
      next.delete(routineId)
      return next
    })
  }

  const clearRoutineUpdates = () => setRoutineUpdates(new Map())
  ```
- [ ] Add custom hook:
  ```typescript
  export const useRoutineUpdates = () => {
    const context = useContext(OptimisticUpdatesContext)
    if (!context) throw new Error("...")

    return {
      getRoutineUpdate: (routineId: string) => context.routineUpdates.get(routineId),
      addRoutineUpdate: context.addRoutineUpdate,
      removeRoutineUpdate: context.removeRoutineUpdate,
      clearRoutineUpdates: context.clearRoutineUpdates
    }
  }
  ```
- [ ] Add to context value

#### 2.2 Create Optimistic Hooks

**New File**: `app/src/lib/optimistic/useOptimisticRoutinePriority.ts`

```typescript
import { createOptimisticHook } from "./createOptimisticHook"
import { api } from "@/convex/_generated/api"

export const useOptimisticRoutinePriority = createOptimisticHook<[number]>({
  actionPath: api.routines.actions.updateRoutine,
  messages: {
    loading: "Updating routine priority...",
    success: "Priority updated",
    error: "Failed to update priority"
  },
  createUpdate: (routineId, newPriority) => ({
    routineId,
    type: "priority-change",
    newPriority,
    timestamp: Date.now()
  }),
  createActionArgs: (routineId, newPriority) => ({
    routineId,
    priority: newPriority
  })
})
```

**Files to Create**:
- [ ] `app/src/lib/optimistic/useOptimisticRoutinePriority.ts`
- [ ] `app/src/lib/optimistic/useOptimisticRoutineProject.ts`
- [ ] `app/src/lib/optimistic/useOptimisticRoutineLabels.ts`

**Testing**:
- [ ] Test optimistic update adds to context immediately
- [ ] Test background API call succeeds
- [ ] Test optimistic update clears on success
- [ ] Test optimistic update removes on error

---

### Phase 3: Dialog Generalization ⏳

**Goal**: Make dialogs work with routines

#### 3.1 ProjectDialog Generalization

**File**: `app/src/components/dialogs/ProjectDialog.tsx`

**Changes**:
- [ ] Update props interface:
  ```typescript
  interface ProjectDialogProps {
    task?: TodoistTask | null
    project?: TodoistProjectWithMetadata | null
    routine?: Doc<"routines"> | null
    onSelect: (projectId: string) => void
    onClose: () => void
  }
  ```
- [ ] Add item resolution:
  ```typescript
  const item = task || project || routine
  const currentProjectId = task?.projectId || project?.todoist_id || routine?.todoistProjectId
  ```
- [ ] Update dialog content based on item type:
  ```typescript
  const dialogTitle = routine
    ? "Set Default Project for Tasks"
    : task
    ? "Move to Project"
    : "Change Project"

  const dialogDescription = routine
    ? "Choose which project new tasks from this routine will be created in"
    : task
    ? "Choose which project to move this task to"
    : "Change the project for this item"
  ```

#### 3.2 LabelDialog Generalization

**File**: `app/src/components/dialogs/LabelDialog.tsx`

**Changes**:
- [ ] Update props interface (same pattern as ProjectDialog)
- [ ] Add item resolution
- [ ] Filter "routine" label when editing routines:
  ```typescript
  const currentLabels = task?.labels
    || routine?.todoistLabels.filter(l => l !== "routine")
    || []
  ```
- [ ] Update dialog content:
  ```typescript
  const description = routine
    ? "Select labels to add to tasks created by this routine (in addition to the automatic 'routine' label)"
    : "Select labels for this task"
  ```

#### 3.3 DialogContext Updates

**File**: `app/src/lib/DialogContext.tsx`

**Changes**:
- [ ] Add `currentRoutine: Doc<"routines"> | null` state
- [ ] Update `openProject`:
  ```typescript
  const openProject = (item: TodoistTask | Doc<"routines">) => {
    if ("todoist_id" in item) {
      setCurrentTask(item)
      setCurrentRoutine(null)
    } else {
      setCurrentRoutine(item)
      setCurrentTask(null)
    }
    setDialogType("project")
  }
  ```
- [ ] Update `openLabel` (same pattern)
- [ ] Verify `openPriority` already accepts all types (should be generic already)
- [ ] Update dialog component props to pass routine

**Testing**:
- [ ] Test opening priority dialog with routine
- [ ] Test opening project dialog with routine
- [ ] Test opening label dialog with routine
- [ ] Test dialog displays correct title/description for routines
- [ ] Test selecting value updates routine correctly

---

### Phase 4: Add Todoist Property Badges ⏳

**Goal**: Display and wire badges for priority, project, labels

#### 4.1 Badge Rendering in RoutineRow

**File**: `app/src/components/RoutineRow.tsx`

**Imports**:
```typescript
import { Flag, Tag, Folder } from "lucide-react"
import { usePriority } from "@/lib/priorities"
import { useDialogContext } from "@/lib/DialogContext"
import { useRoutineUpdates } from "@/lib/optimistic/OptimisticUpdatesContext"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
```

**Data Fetching**:
```typescript
const { openPriority, openProject, openLabel } = useDialogContext()
const { getRoutineUpdate, removeRoutineUpdate } = useRoutineUpdates()
const optimisticUpdate = getRoutineUpdate(routine._id)

// Get projects for display
const projects = useQuery(api.todoist.queries.getProjectsWithMetadata)
const displayProject = projects?.find(p => p.todoist_id === routine.todoistProjectId)

// Merge optimistic updates
const effectivePriority = optimisticUpdate?.type === "priority-change"
  ? optimisticUpdate.newPriority
  : routine.priority

const effectiveProjectId = optimisticUpdate?.type === "project-change"
  ? optimisticUpdate.newProjectId
  : routine.todoistProjectId

const effectiveLabels = optimisticUpdate?.type === "label-change"
  ? optimisticUpdate.newLabels
  : routine.todoistLabels

// Get priority display
const priority = usePriority(effectivePriority)

// Filter out "routine" label (auto-applied, per user preference)
const displayLabels = effectiveLabels.filter(l => l !== "routine")
```

**Badge Components**:

- [ ] Priority Badge:
  ```tsx
  {priority?.showFlag && (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-normal cursor-pointer", priority.colorClass)}
      onClick={(e) => {
        e.stopPropagation()
        openPriority(routine)
      }}
    >
      <Flag className="h-3 w-3" fill="currentColor" />
      <span>{priority.label}</span>
    </Badge>
  )}
  ```

- [ ] Project Badge:
  ```tsx
  {displayProject && (
    <Badge
      variant="outline"
      className="gap-1.5 font-normal cursor-pointer"
      onClick={(e) => {
        e.stopPropagation()
        openProject(routine)
      }}
    >
      <div
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: getProjectColor(displayProject.color) }}
      />
      <span>{displayProject.name}</span>
    </Badge>
  )}
  ```

- [ ] Label Badges:
  ```tsx
  {displayLabels.map(label => (
    <Badge
      key={label}
      variant="secondary"
      className="gap-1.5 font-normal group/label border cursor-pointer"
      onClick={(e) => {
        e.stopPropagation()
        openLabel(routine)
      }}
    >
      <Tag className="h-3 w-3" />
      <span>{label}</span>
    </Badge>
  ))}
  ```

- [ ] Ghost Badges (on hover):
  ```tsx
  {isHovered && !priority?.showFlag && (
    <Badge
      variant="outline"
      className="border-dashed text-muted-foreground cursor-pointer"
      onClick={(e) => {
        e.stopPropagation()
        openPriority(routine)
      }}
    >
      <Flag className="h-3 w-3" />
      <span>P4</span>
    </Badge>
  )}

  {isHovered && !displayProject && (
    <Badge
      variant="outline"
      className="border-dashed text-muted-foreground cursor-pointer"
      onClick={(e) => {
        e.stopPropagation()
        openProject(routine)
      }}
    >
      <Folder className="h-3 w-3" />
      <span>Set project</span>
    </Badge>
  )}

  {isHovered && displayLabels.length === 0 && (
    <Badge
      variant="outline"
      className="border-dashed text-muted-foreground cursor-pointer"
      onClick={(e) => {
        e.stopPropagation()
        openLabel(routine)
      }}
    >
      <Tag className="h-3 w-3" />
      <span>Add label</span>
    </Badge>
  )}
  ```

#### 4.2 Optimistic Update Integration

**Cleanup Effects**:
```typescript
// Clear priority update when DB syncs
useEffect(() => {
  if (optimisticUpdate?.type === "priority-change" &&
      routine.priority === optimisticUpdate.newPriority) {
    removeRoutineUpdate(routine._id)
  }
}, [routine.priority, optimisticUpdate, removeRoutineUpdate, routine._id])

// Clear project update when DB syncs
useEffect(() => {
  if (optimisticUpdate?.type === "project-change" &&
      routine.todoistProjectId === optimisticUpdate.newProjectId) {
    removeRoutineUpdate(routine._id)
  }
}, [routine.todoistProjectId, optimisticUpdate, removeRoutineUpdate, routine._id])

// Clear label update when DB syncs
useEffect(() => {
  if (optimisticUpdate?.type === "label-change" &&
      JSON.stringify(routine.todoistLabels.sort()) === JSON.stringify(optimisticUpdate.newLabels.sort())) {
    removeRoutineUpdate(routine._id)
  }
}, [routine.todoistLabels, optimisticUpdate, removeRoutineUpdate, routine._id])
```

**Testing**:
- [ ] Test priority badge displays correctly
- [ ] Test project badge displays correctly
- [ ] Test label badges display correctly
- [ ] Test ghost badges appear on hover
- [ ] Test clicking badges opens correct dialogs
- [ ] Test optimistic updates apply immediately
- [ ] Test optimistic updates clear on DB sync

---

### Phase 5: Keyboard Shortcuts ⏳

**Goal**: Enable quick property editing via keyboard

#### 5.1 Create Hook

**New File**: `app/src/lib/shortcuts/useRoutineDialogShortcuts.ts`

```typescript
import { useEffect } from "react"
import { useDialogContext } from "@/lib/DialogContext"
import type { Doc } from "@/convex/_generated/dataModel"

export function useRoutineDialogShortcuts(focusedRoutine: Doc<"routines"> | null) {
  const { openPriority, openProject, openLabel } = useDialogContext()

  useEffect(() => {
    if (!focusedRoutine) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target

      // Don't trigger in input fields
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case 'p':
          e.preventDefault()
          openPriority(focusedRoutine)
          break
        case '#':
          e.preventDefault()
          openProject(focusedRoutine)
          break
        case '@':
          e.preventDefault()
          openLabel(focusedRoutine)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusedRoutine, openPriority, openProject, openLabel])
}
```

#### 5.2 Integration

**File**: `app/src/components/RoutinesListView.tsx`

**Changes**:
- [ ] Import: `import { useRoutineDialogShortcuts } from "@/lib/shortcuts/useRoutineDialogShortcuts"`
- [ ] Call hook: `useRoutineDialogShortcuts(focusedRoutine)`

**Testing**:
- [ ] Test 'p' opens priority dialog when routine focused
- [ ] Test '#' opens project dialog when routine focused
- [ ] Test '@' opens label dialog when routine focused
- [ ] Test shortcuts don't trigger in input fields
- [ ] Test shortcuts don't trigger when routine not focused
- [ ] Test shortcuts work correctly in multi-view layout

---

### Phase 6: Validation & Testing ⏳

**Goal**: Ensure everything works correctly

#### 6.1 TypeScript & Linting

- [ ] Run `bun run typecheck` - must pass with 0 errors
- [ ] Run `bun run lint` - must pass with 0 errors
- [ ] Run `bun test` - all tests must pass
- [ ] Fix any issues found

#### 6.2 Visual Testing (Chrome Dev Tools MCP)

Using visual-testing skill:

- [ ] Verify RoutineRow matches TaskRow/ProjectRow visual style
- [ ] Test focus styling on keyboard navigation (↑/↓ arrows)
- [ ] Test hover states and ghost badges appear/disappear
- [ ] Test all three property badges display correctly
- [ ] Test badge click interactions open correct dialogs
- [ ] Test keyboard shortcuts (p, #, @) work correctly
- [ ] Test badge layout wraps correctly with many properties
- [ ] Test completion rate and stats still display properly
- [ ] Test defer toggle still works
- [ ] Test dialog title/description shows correctly for routines

#### 6.3 Functionality Testing

**Priority Testing**:
- [ ] Create routine with no priority set (P4 default)
- [ ] Click priority badge → opens dialog
- [ ] Select P1 → optimistic update shows immediately
- [ ] Verify DB sync clears optimistic update
- [ ] Press 'p' on focused routine → opens dialog
- [ ] Change to P3 → verify update persists after refresh

**Project Testing**:
- [ ] Create routine with no project set
- [ ] Hover → ghost badge "Set project" appears
- [ ] Click ghost badge → opens dialog
- [ ] Select project → verify badge shows with color dot
- [ ] Press '#' on focused routine → opens dialog
- [ ] Change project → verify update persists

**Label Testing**:
- [ ] Create routine with no labels
- [ ] Hover → ghost badge "Add label" appears
- [ ] Click ghost badge → opens dialog
- [ ] Select multiple labels → verify badges show
- [ ] Verify "routine" label is NOT shown (filtered out)
- [ ] Press '@' on focused routine → opens dialog
- [ ] Add/remove labels → verify changes persist
- [ ] Check Todoist: generated tasks should have "routine" + additional labels

**Integration Testing**:
- [ ] Create routine with all properties set
- [ ] Edit all three properties in sequence
- [ ] Generate tasks → verify they inherit properties correctly
- [ ] Complete task in Todoist → verify completion rate updates
- [ ] Verify all keyboard shortcuts work in context
- [ ] Test with multiple routines focused in sequence

#### 6.4 Edge Cases

- [ ] Routine with very long name (test truncation)
- [ ] Routine with many labels (test badge wrapping)
- [ ] Changing property while optimistic update pending
- [ ] Network error during property change (rollback)
- [ ] Dialog opened, then routine deleted
- [ ] Multiple rapid property changes
- [ ] Routine in deferred state (properties still editable)

---

## 🎨 Design Decisions

### 1. Badge Display

**Decision**: Show only additional labels (filter out "routine")

**Rationale**: "routine" label is automatically applied to all generated tasks. Showing it on every routine is redundant. Users care about the ADDITIONAL labels they're adding.

### 2. Keyboard Shortcuts

**Decision**: Use same keys as tasks (p, #, @)

**Rationale**: Context-aware shortcuts reduce cognitive load. FocusContext ensures the correct item is being edited based on what's focused. Users don't need to remember different keys for different item types.

### 3. Badge Layout

**Decision**: Separate line below name/description

**Rationale**: Consistency with task/project pattern. Prevents horizontal overflow. Clearer visual hierarchy between content and metadata.

### 4. Completion Rate Display

**Decision**: Keep as right-side stat (not badge)

**Rationale**: Completion rate and duration are routine-specific metrics, not Todoist properties. Maintaining visual distinction helps users understand the difference between routine metadata and task generation settings.

### 5. Defer Button Position

**Decision**: Keep on right side (hover-visible)

**Rationale**: Pause/play is a primary action separate from property editing. Current UX works well - don't change what works.

### 6. Optimistic Updates

**Decision**: Full optimistic UI for all property changes

**Rationale**: Consistency with task/project UX. Users expect instant feedback. Reduces perceived latency. Makes the app feel snappier.

---

## 🔍 Technical Details

### Todoist Priority System (CRITICAL)

**Inverted numbering**:
| API Value | UI Display | Visual |
|-----------|------------|--------|
| 4 | P1 | 🔴 Red |
| 3 | P2 | 🟠 Orange |
| 2 | P3 | 🔵 Blue |
| 1 | P4 | No flag |

**Always use**:
- `app/src/lib/priorities.ts` - `usePriority(priority)` hook
- `convex/todoist/types/priorities.ts` - Canonical mapping

**Never**:
- Hardcode priority numbers
- Assume higher number = higher priority

### Label Filtering

```typescript
// ✅ CORRECT - Filter "routine" from display
const displayLabels = routine.todoistLabels.filter(l => l !== "routine")

// ❌ WRONG - Show all labels
const displayLabels = routine.todoistLabels
```

**Reasoning**: "routine" label is automatically added by the system. It's metadata, not user choice.

### Optimistic Update Lifecycle

1. **Trigger**: User clicks badge or presses keyboard shortcut
2. **Immediate**: `flushSync()` adds update to OptimisticUpdatesContext
3. **Render**: Component re-renders with optimistic state merged
4. **Background**: API call to `api.routines.actions.updateRoutine`
5. **Success**: DB updates, React Query refetches
6. **Component Effect**: Detects DB matches optimistic value, calls `removeRoutineUpdate`
7. **Cleanup**: Optimistic update removed, rendering now from DB only
8. **Failure**: Remove update immediately (UI reverts), show error toast

### Focus Management Edge Cases

**Array Bounds Protection**:
```typescript
useEffect(() => {
  if (visibleRoutines.length > 0 && focusedRoutineIndex >= visibleRoutines.length) {
    setFocusedRoutineIndex(Math.max(0, visibleRoutines.length - 1))
  }
}, [visibleRoutines.length, focusedRoutineIndex])
```

**Cleanup on Unmount**:
```typescript
refHandlers.current[index] = (element) => {
  refs.current[index] = element
  if (element === null && lastFocusedIndex.current === index) {
    lastFocusedIndex.current = null
  }
}
```

---

## 📊 Progress Tracking

### Overall Completion: 0/6 Phases (0%)

- [ ] Phase 1: Standardize RoutineRow Structure
- [ ] Phase 2: Optimistic Updates Infrastructure
- [ ] Phase 3: Dialog Generalization
- [ ] Phase 4: Add Todoist Property Badges
- [ ] Phase 5: Keyboard Shortcuts
- [ ] Phase 6: Validation & Testing

---

## 🗂️ File Inventory

### Files to Create (4)

- [ ] `app/src/lib/optimistic/useOptimisticRoutinePriority.ts`
- [ ] `app/src/lib/optimistic/useOptimisticRoutineProject.ts`
- [ ] `app/src/lib/optimistic/useOptimisticRoutineLabels.ts`
- [ ] `app/src/lib/shortcuts/useRoutineDialogShortcuts.ts`

### Files to Modify (7)

- [ ] `app/src/components/RoutineRow.tsx` - Complete restructure
- [ ] `app/src/components/RoutinesListView.tsx` - Focus management overhaul
- [ ] `app/src/lib/optimistic/OptimisticUpdatesContext.tsx` - Add routine support
- [ ] `app/src/contexts/FocusContext.tsx` - Add focusedRoutine
- [ ] `app/src/components/dialogs/ProjectDialog.tsx` - Generalize for routines
- [ ] `app/src/components/dialogs/LabelDialog.tsx` - Generalize for routines
- [ ] `app/src/lib/DialogContext.tsx` - Add routine handlers

---

## 🔗 References

### Related Documentation

- `docs/routines-system-implementation.md` - Parent project (initial implementation)
- `docs/keyboard-shortcuts-architecture.md` - Keyboard shortcut patterns
- `docs/optimistic-updates-plan.md` - Optimistic updates architecture
- `CLAUDE.md` - Development standards

### Related Components

**Reference Implementations**:
- `app/src/components/TaskListView.tsx` - Standard list pattern
- `app/src/components/ProjectRow.tsx` - Standard row pattern
- `app/src/lib/shortcuts/useTaskDialogShortcuts.ts` - Shortcut pattern

**Current Routine Files**:
- `app/src/components/RoutineRow.tsx` - To be refactored
- `app/src/components/RoutinesListView.tsx` - Focus management to update
- `app/src/components/dialogs/RoutineDialog.tsx` - Full edit dialog (keep as-is)
- `app/src/components/dialogs/RoutineDetailDialog.tsx` - Stats view (keep as-is)

**Shared Infrastructure**:
- `app/src/lib/optimistic/OptimisticUpdatesContext.tsx` - Optimistic state
- `app/src/lib/optimistic/createOptimisticHook.ts` - Hook factory
- `app/src/contexts/FocusContext.tsx` - Focus tracking
- `app/src/lib/DialogContext.tsx` - Dialog management
- `app/src/lib/priorities.ts` - Priority utilities

### Useful Commands

```bash
# Development
bunx convex dev
bun --cwd app run dev

# Validation (REQUIRED before commits)
bun run typecheck && bun run lint && bun test

# Visual testing
# Use visual-testing skill with Chrome Dev Tools MCP

# Test routine property updates
bunx convex run routines:publicQueries.getRoutines
# (check Convex dashboard for data)

# Verify in Todoist
# Use Todoist MCP to check generated tasks have correct properties
```

---

## 📝 Notes & Learnings

### Implementation Notes
```
[Add notes here as implementation progresses]
```

### Issues Encountered
```
[Track issues and resolutions here]
```

---

**Last Updated**: 2025-11-15 (Planning Complete)
