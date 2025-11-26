# List Item Standardization - Planning Document

## Executive Summary

This document analyzes the current implementation of list items across Tasks, Projects, and Routines to identify patterns, differences, and opportunities for standardization. The goal is to create a reusable, extensible list item component that reduces code duplication and makes it easy to add new entity types.

---

## Current Implementation Analysis

### 1. Tasks (Todoist Items)

**Files:**
- `app/src/components/TaskListView.tsx` (987 lines)
- Row component: `TaskRow` (inline in same file, ~630 lines)

**Key Features:**
- ✅ Inline editing (Enter for content, Shift+Enter for description)
- ✅ Optimistic updates for all properties
- ✅ Keyboard shortcuts (`p`=priority, `#`=project, `@`=labels, `s`=schedule, `D`=deadline, `c`=complete, `Delete`=delete)
- ✅ Focus management with visual highlighting
- ✅ Hover state with "ghost" badges for adding properties
- ✅ Badge system for properties

**Left Icon:** Checkbox (for completion)

**Display Structure:**
```
[Checkbox] [Content]
           [Description (optional)]
           [Badges: Project, Priority, Due, Deadline, Labels, Assignee]
           [Ghost badges on hover: Priority, Schedule, Deadline, Labels]
```

**Badges:**
- Project (with color dot)
- Priority (flag icon, P1-P3, only shown if not P4)
- Due Date (calendar icon, colored by status)
- Deadline (alert icon, colored by urgency)
- Labels (tag icon, colored borders)
- Assignee (user icon)
- Ghost badges (dashed border, shown on hover)

**Optimistic Updates:**
- Text changes (content, description)
- Priority changes
- Project moves (with immediate hide in project views)
- Label changes
- Due date changes
- Deadline changes
- Task completion (immediate hide)

**Data Attributes:**
- `data-task-id="{todoist_id}"`

---

### 2. Projects

**Files:**
- `app/src/components/ProjectsListView.tsx` (323 lines)
- `app/src/components/ProjectRow.tsx` (336 lines)

**Key Features:**
- ✅ Inline editing (Enter for name, Shift+Enter for description)
- ✅ Optimistic updates for name, description, priority
- ✅ Keyboard shortcuts (`p`=priority, `e`=archive)
- ✅ Focus management with visual highlighting
- ✅ Hover state with ghost badges
- ✅ Badge system for properties

**Left Icon:** Color dot (project color)

**Display Structure:**
```
[Color Dot] [Name]
            [Description (optional)]
            [Badges: Priority, Active Count, Archive]
            [Ghost badges on hover: Priority]
```

**Badges:**
- Priority (flag icon, P1-P3, only shown if not P4)
- Active Count (shows number of active tasks)
- Archive button (archive icon, shown on hover)
- Ghost priority badge (shown on hover if P4)

**Optimistic Updates:**
- Text changes (name, description)
- Priority changes

**Data Attributes:**
- `data-project-id="{todoist_id}"`

---

### 3. Routines

**Files:**
- `app/src/components/RoutinesListView.tsx` (325 lines)
- `app/src/components/RoutineRow.tsx` (290 lines)
- `app/src/components/badges/RoutineBadges.tsx` (245 lines)

**Key Features:**
- ❌ NO inline editing (uses dialog instead)
- ✅ Optimistic updates for priority, project, labels
- ✅ Keyboard shortcuts (via `useRoutineDialogShortcuts`)
- ✅ Focus management with visual highlighting
- ✅ Hover state with ghost badges
- ✅ Badge system with dedicated badge components
- ✅ Visual distinction for paused routines (opacity)

**Left Icon:** Repeat icon (purple)

**Display Structure:**
```
[Repeat Icon] [Name]
              [Description (optional)]
              [Badges: Project, Frequency, Time of Day, Ideal Day, Duration, Priority, Labels, Details, Edit]
              [Ghost badges on hover: Priority, Project, Labels, Time of Day, Ideal Day, Edit]
```

**Badges:**
- Project (with color dot, via `ProjectBadge`)
- Frequency (colored by type: green=daily, blue=weekly, purple=monthly)
- Time of Day (sun icon, conditional on frequency)
- Ideal Day (calendar icon, shows day name, conditional on frequency)
- Duration (clock icon)
- Priority (flag icon, P1-P3, via `PriorityBadge`)
- Labels (tag icon, via `LabelBadge`)
- Details (info icon, shows completion rate %)
- Edit badge (edit icon, always on hover)
- Ghost badges for missing properties

**Optimistic Updates:**
- Priority changes
- Project changes
- Label changes

**Data Attributes:**
- `data-routine-id="{_id}"`

---

## Common Patterns Identified

### 1. Component Structure

All three follow a similar structure:

```tsx
// ListView wrapper
function EntityListView({
  list,
  onEntityCountChange,
  onEntityClick,
  focusedEntityIndex,
  isDismissed,
  onDismiss,
  onRestore,
  isMultiListView
})

// Row component
const EntityRow = memo(function EntityRow({
  entity,
  onElementRef,
  onClick,
  // entity-specific props
}))
```

### 2. Focus Management

All three use identical focus management pattern:
- `useRef` for element references
- `lastFocusedIndex` tracking
- CSS class toggling: `["bg-accent/50", "border-primary/30"]`
- `aria-selected` attribute management
- Scroll-into-view logic
- Focus context integration

**Code duplication: ~50 lines per component**

### 3. Optimistic Updates

All three use the OptimisticUpdatesContext pattern:
- `getEntityUpdate(id)` to retrieve optimistic state
- `removeEntityUpdate(id)` to clear after DB sync
- `useEffect` hooks to clear optimistic updates when DB matches
- Display values computed from `optimisticUpdate || realValue`

**Code duplication: ~40-80 lines per component**

### 4. Keyboard Shortcuts

All three have dedicated hooks following the same pattern:
- Listen for keydown events
- Ignore if target is input/textarea
- Handle Enter/Shift+Enter for editing (Tasks & Projects)
- Handle property shortcuts (`p`, `#`, `@`, etc.)
- Integration with DialogContext

**Code duplication: ~55 lines per hook**

### 5. Editing State Management

Tasks and Projects share identical inline editing pattern:
- `isEditing` state
- `showDescriptionInput` state
- `editContent` / `editName` state
- `editDescription` state
- `startEditing()` and `startEditingDescription()` callbacks
- `cancelEditing()` and `saveEditing()` functions
- Tab navigation between fields
- Ref management for inputs
- Exposing functions via DOM element properties

**Code duplication: ~120 lines per component**

### 6. Hover State

All three track hover state for ghost badges:
- `isHovered` state
- `onMouseEnter` / `onMouseLeave`
- Conditional rendering of ghost badges

**Code duplication: ~20 lines per component**

### 7. Badge System

All three use badge components for properties, with common patterns:
- Priority badges (flag icon, color classes)
- Project badges (with color dot)
- Label badges (tag icon)
- Ghost badges (dashed border, muted text)
- Click handlers that stop propagation

**Routines extracted badges to separate file, others inline**

### 8. Row Styling

All three use identical base styling:
```tsx
className={cn(
  "group cursor-pointer transition-all duration-150 rounded-md border border-transparent p-2.5",
  "hover:bg-accent/50",
  "focus:outline-none focus:bg-accent/50 focus:border-primary/30"
)}
```

---

## Key Differences

### 1. Left Icon/Action

| Entity   | Left Element        | Purpose           |
|----------|---------------------|-------------------|
| Tasks    | Checkbox            | Mark complete     |
| Projects | Color Dot           | Visual identifier |
| Routines | Repeat Icon         | Entity type marker|

### 2. Editing Approach

| Entity   | Current Approach | Target Approach |
|----------|-----------------|-----------------|
| Tasks    | Inline          | Inline          |
| Projects | Inline          | Inline          |
| Routines | Dialog          | **Inline** ✨   |

**Note:** The dialog approach for routines was an implementation divergence, not intentional. We should standardize on inline editing for name/description across all entity types. Complex properties (frequency, time of day, etc.) will still use dialogs, but basic text editing should be inline and consistent.

### 3. Badge Complexity

| Entity   | Badge Count | Conditional Badges | Ghost Badges |
|----------|-------------|-------------------|--------------|
| Tasks    | 6 types     | Yes (dates, labels, assignee) | 4 |
| Projects | 3 types     | Yes (active count) | 1 |
| Routines | 9 types     | Yes (time, ideal day, duration) | 5 |

### 4. Data Source

| Entity   | Source              | ID Field       |
|----------|---------------------|----------------|
| Tasks    | Todoist API         | `todoist_id`   |
| Projects | Todoist API + metadata | `todoist_id` |
| Routines | Convex DB           | `_id`          |

### 5. Optimistic Update Scope

| Entity   | Optimistic Properties |
|----------|----------------------|
| Tasks    | Text, Priority, Project, Labels, Due, Deadline, Complete |
| Projects | Name, Description, Priority |
| Routines | Priority, Project, Labels |

---

## Shared Infrastructure

### 1. Contexts

All three depend on:
- `OptimisticUpdatesContext` - Manages optimistic state
- `DialogContext` - Opens property dialogs
- `FocusContext` - Tracks focused entity
- `CountContext` - Manages list counts

### 2. Hooks

Pattern for optimistic updates:
- `useOptimistic{Property}` hooks follow consistent pattern
- All use `flushSync` for immediate updates
- All use `useTodoistAction` or similar wrapper
- Cleanup via `useEffect` when DB syncs

Pattern for keyboard shortcuts:
- `use{Entity}DialogShortcuts` hooks
- All listen to window keydown
- All check for input/textarea focus
- All integrate with DialogContext

### 3. Utilities

All three use:
- `usePriority()` - Priority display logic
- `getProjectColor()` - Project color mapping
- `cn()` - Class name composition
- Badge components from `@/components/ui/badge`

---

## Code Duplication Metrics

### High Duplication Areas (>80% similar)

1. **Focus Management Logic**: ~50 lines × 3 = 150 lines
2. **Hover State Management**: ~20 lines × 3 = 60 lines
3. **Row Base Styling**: ~15 lines × 3 = 45 lines
4. **Ref Handler Creation**: ~15 lines × 3 = 45 lines
5. **Optimistic Update Clearing**: ~40 lines × 3 = 120 lines

**Total highly duplicated: ~420 lines**

### Medium Duplication Areas (50-80% similar)

1. **Inline Editing Logic**: ~120 lines × 2 (Tasks, Projects) = 240 lines
2. **Keyboard Shortcut Hooks**: ~55 lines × 3 = 165 lines
3. **ListView Wrapper Logic**: ~100 lines × 3 = 300 lines

**Total medium duplicated: ~705 lines**

### Low Duplication Areas (<50% similar)

1. **Badge Rendering**: Varies significantly
2. **Entity-specific Actions**: Unique per type
3. **Data Fetching**: Different queries

---

## Proposed Standardization Strategy

### Phase 1: Extract Common Utilities

**Goal:** Reduce duplication without changing component structure

1. **Create `useListItemFocus` hook**
   - Extract focus management logic
   - Parameterize entity type for data attributes
   - Handle ref management, highlighting, scrolling
   - **Saves: ~150 lines**

2. **Create `useListItemHover` hook**
   - Extract hover state management
   - **Saves: ~60 lines**

3. **Create `useListItemEditing` hook** (for Tasks/Projects)
   - Extract inline editing state and logic
   - Parameterize field names
   - **Saves: ~240 lines**

4. **Create `useOptimisticSync` utility**
   - Extract optimistic update clearing logic
   - Parameterize entity type and update type
   - **Saves: ~120 lines**

**Total savings Phase 1: ~570 lines**

### Phase 2: Standardize Badge System

**Goal:** Pure view components that are entity-agnostic

**Design Philosophy:**
- Badges are **pure presentation components**
- Entities map their data to badge props
- Click handlers are passed in, not hardcoded
- Same badge component used across all entity types

**Example:**
```tsx
// Badge is entity-agnostic
<PriorityBadge
  priority={usePriority(entity.priority)} // Each entity maps to this
  onClick={() => openPriorityDialog(entity)} // Each entity provides handler
  isGhost={false}
/>

// Works for tasks, projects, routines - same badge, different data source
```

**Implementation Steps:**

1. **Extract badge components to `components/badges/shared/`**
   - `PriorityBadge.tsx` - Flag icon, priority label, color classes
   - `ProjectBadge.tsx` - Color dot, project name
   - `LabelBadge.tsx` - Tag icon, label name, colored borders
   - `DateBadge.tsx` - Calendar/Alert icon, formatted date, status colors
   - `GhostBadge.tsx` - Generic ghost badge (dashed border, muted)

2. **Standardize props interface**
   ```tsx
   interface BaseBadgeProps {
     onClick: (e: React.MouseEvent) => void
     isGhost?: boolean
     className?: string
   }

   interface PriorityBadgeProps extends BaseBadgeProps {
     priority: {
       label: string
       colorClass: string | null
       showFlag: boolean
     }
   }
   ```

3. **Entity-specific badge orchestration**
   - Each entity Row component maps its data to badges
   - Each entity provides appropriate click handlers
   - Dialog context determines which dialog to open

**Benefits:**
- Single source of truth for badge styling
- Easy to update badge appearance globally
- New entity types just map to existing badges
- Testing: test badge once, not per entity

### Phase 3: Create Base ListItem Component

**Goal:** Shared foundation with entity-specific customization

Create a flexible `BaseListItem` component:

```tsx
interface BaseListItemProps<T> {
  // Core props
  entity: T
  onElementRef: (element: HTMLDivElement | null) => void
  onClick?: () => void

  // Entity identification
  entityType: 'task' | 'project' | 'routine' | string
  getEntityId: (entity: T) => string

  // Left icon/action
  renderLeftElement: (entity: T) => React.ReactNode

  // Content rendering
  renderContent: (entity: T) => React.ReactNode
  renderDescription?: (entity: T) => React.ReactNode | null

  // Badges
  renderBadges: (entity: T, isHovered: boolean) => React.ReactNode

  // Editing (optional)
  editing?: {
    isEditing: boolean
    onStartEditing: () => void
    onStartEditingDescription?: () => void
    renderEditingUI: () => React.ReactNode
  }

  // Optimistic updates (optional)
  optimisticUpdate?: unknown

  // Styling overrides (optional)
  className?: string
  additionalClassNames?: {
    row?: string
    content?: string
    badges?: string
  }
}
```

**Benefits:**
- Focus management built-in
- Hover state built-in
- Base styling consistent
- Easy to add new entity types
- Opt-in to editing, optimistic updates

### Phase 4: Create Base ListView Component

**Goal:** Shared list wrapper with entity-specific rendering

Create a flexible `BaseListView` component:

```tsx
interface BaseListViewProps<T> {
  // List configuration
  list: ListInstance
  entities: T[] | undefined

  // Callbacks
  onEntityCountChange?: (listId: string, count: number) => void
  onEntityClick?: (listId: string, entityIndex: number) => void

  // Focus
  focusedEntityIndex: number | null

  // Collapse/expand
  isDismissed?: boolean
  onDismiss?: (listId: string) => void
  onRestore?: (listId: string) => void
  isMultiListView?: boolean

  // Rendering
  renderRow: (entity: T, index: number, onElementRef: (el: HTMLDivElement | null) => void) => React.ReactNode

  // Entity identification
  getEntityId: (entity: T) => string

  // Focus context integration
  setFocusedEntity: (entity: T | null) => void

  // Keyboard shortcuts hook
  useEntityShortcuts: (entity: T | null) => void

  // Loading state
  isLoading?: boolean
}
```

**Benefits:**
- Header rendering built-in
- Empty state handling built-in
- Collapse/expand built-in
- Focus management built-in
- Count tracking built-in

---

## Migration Path

**Strategy:** Incremental migration - we don't need to swap everything at once. Each phase is a milestone that can be completed independently.

### Step 1: Extract Hooks (Low Risk) ⭐ START HERE

1. Create `useListItemFocus`
2. Create `useListItemHover`
3. Create `useListItemEditing`
4. Create `useOptimisticSync`
5. **Incrementally refactor**: Pick ONE entity type (suggest Tasks), refactor to use new hooks, test thoroughly
6. Once confident, refactor next entity type (Projects)
7. Finally, refactor Routines + add inline editing

**Timeline: 1-2 days**
**Risk: Low** - No component structure changes
**Migration: One entity at a time**

### Step 2: Standardize Badges (Medium Risk)

1. Create `components/badges/shared/` directory
2. Extract badge components with standardized props
3. **Incrementally migrate**: Start with ONE badge type (e.g., `PriorityBadge`)
   - Extract to shared component
   - Update Tasks to use it
   - Update Projects to use it
   - Update Routines to use it
4. Repeat for each badge type (Project, Label, Date, etc.)
5. Extract ghost badge logic

**Timeline: 1-2 days**
**Risk: Medium** - Visual changes, need testing
**Migration: One badge type at a time**

### Step 3: Create Base Components (High Risk)

1. Create `BaseListItem` component (with extensive TypeScript generics)
2. **Incrementally migrate**: Start with ONE entity type
   - Create TaskListItem wrapper using BaseListItem
   - Run side-by-side with old implementation
   - Test thoroughly, compare behavior
   - Once confident, switch over
3. Repeat for Projects
4. Repeat for Routines (+ add inline editing at this stage)
5. Remove old implementations once all migrated

**Timeline: 2-3 days**
**Risk: High** - Major refactor, need extensive testing
**Migration: One entity at a time, can run old/new side-by-side**

### Step 4: Create Base ListView (High Risk)

1. Create `BaseListView` component (with extensive TypeScript generics)
2. **Incrementally migrate**: Start with ONE view
   - Refactor TaskListView to use BaseListView
   - Test list rendering, collapse/expand, counts, etc.
3. Repeat for ProjectsListView
4. Repeat for RoutinesListView
5. Remove duplicate code once all migrated

**Timeline: 2-3 days**
**Risk: High** - Major refactor, need extensive testing
**Migration: One view at a time**

---

## Success Metrics

### Code Reduction

**Current state:**
- TaskListView.tsx: 987 lines
- ProjectRow.tsx: 336 lines
- ProjectsListView.tsx: 323 lines
- RoutineRow.tsx: 290 lines
- RoutinesListView.tsx: 325 lines
- **Total: 2,261 lines**

**Target state (estimated):**
- BaseListItem.tsx: 200 lines
- BaseListView.tsx: 250 lines
- TaskRow.tsx: 150 lines (specific rendering)
- ProjectRow.tsx: 100 lines (specific rendering)
- RoutineRow.tsx: 120 lines (specific rendering)
- TaskListView.tsx: 80 lines (wrapper)
- ProjectsListView.tsx: 80 lines (wrapper)
- RoutinesListView.tsx: 80 lines (wrapper)
- Shared hooks: 200 lines
- **Total: 1,260 lines**

**Reduction: ~44%** (1,000 lines saved)

### Ease of Adding New Entity Type

**Current state:**
- Copy existing component (~1,000 lines)
- Modify all the repeated logic
- Risk of missing patterns
- **Estimate: 1-2 days per entity type**

**Target state:**
- Implement entity-specific rendering (200-300 lines)
- Configure BaseListItem and BaseListView
- Implement entity-specific hooks (if needed)
- **Estimate: 0.5-1 day per entity type**

### Maintainability

**Current state:**
- Bug fix needs to be applied 3 times
- Feature addition needs to be implemented 3 times
- Pattern divergence over time

**Target state:**
- Bug fix in base component fixes all
- Feature addition in base component benefits all
- Patterns enforced by base components

---

## New Entity Type Checklist

When adding a new entity type to the system, follow this checklist:

### 1. Data Layer
- [ ] Define entity schema (Convex or external API)
- [ ] Create queries to fetch entities
- [ ] Create mutations to update entities
- [ ] Add entity to count registry (if using views)

### 2. Optimistic Updates Pattern
- [ ] Add entity type to `OptimisticUpdatesContext`
  ```tsx
  // Add to context state
  const [entityUpdates, setEntityUpdates] = useState<Map<string, OptimisticUpdate>>(new Map())
  ```
- [ ] Create update type definitions
  ```tsx
  type EntityUpdate =
    | { type: "text-change"; newName?: string; newDescription?: string }
    | { type: "priority-change"; newPriority: number }
    | { type: "project-change"; newProjectId: string }
    // ... other properties
  ```
- [ ] Create optimistic hooks for each property
  ```tsx
  useOptimisticEntityPriority(entityId, newPriority)
  useOptimisticEntityProject(entityId, newProjectId)
  // Pattern: immediate flushSync update + background API call
  ```
- [ ] Add cleanup logic in Row component
  ```tsx
  // Clear optimistic update when DB syncs
  useEffect(() => {
    if (optimisticUpdate?.type === "priority-change" &&
        entity.priority === optimisticUpdate.newPriority) {
      removeEntityUpdate(entity.id)
    }
  }, [entity.priority, optimisticUpdate])
  ```

### 3. Focus Management
- [ ] Add entity type to `FocusContext`
  ```tsx
  const [focusedEntity, setFocusedEntity] = useState<Entity | null>(null)
  ```
- [ ] Use `useListItemFocus` hook in ListView
  ```tsx
  useListItemFocus({
    entityType: 'entity',
    focusedIndex: focusedEntityIndex,
    entities: visibleEntities,
    elementRefs: entityRefs
  })
  ```
- [ ] Add data attribute to row
  ```tsx
  <div data-entity-id={entity.id}>
  ```

### 4. Keyboard Shortcuts
- [ ] Create `useEntityDialogShortcuts` hook
  ```tsx
  export function useEntityDialogShortcuts(focusedEntity: Entity | null) {
    const { openPriority, openProject, ... } = useDialogContext()

    useEffect(() => {
      if (!focusedEntity) return

      const handleKeyDown = (e: KeyboardEvent) => {
        // Skip if in input/textarea
        if (e.target instanceof HTMLInputElement || ...) return

        switch (e.key) {
          case 'p': openPriority(focusedEntity); break
          case '#': openProject(focusedEntity); break
          // ... other shortcuts
        }
      }

      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }, [focusedEntity, ...])
  }
  ```
- [ ] Add inline editing shortcuts (Enter, Shift+Enter, Tab)
- [ ] Document shortcuts in help dialog

### 5. Inline Editing
- [ ] Use `useListItemEditing` hook
  ```tsx
  const editing = useListItemEditing({
    entity,
    fields: {
      primary: { value: entity.name, key: 'name' },
      secondary: { value: entity.description, key: 'description' }
    },
    onSave: async (changes) => {
      await updateEntity(entity.id, changes)
    }
  })
  ```
- [ ] Add editing UI to row component
- [ ] Expose `startEditing` and `startEditingDescription` via DOM element

### 6. Badge Mapping
- [ ] Map entity properties to badge props
  ```tsx
  // Priority
  const priority = usePriority(effectivePriority)
  {priority?.showFlag && (
    <PriorityBadge
      priority={priority}
      onClick={(e) => { e.stopPropagation(); openPriority(entity) }}
    />
  )}

  // Project
  {displayProject && (
    <ProjectBadge
      project={displayProject}
      onClick={(e) => { e.stopPropagation(); openProject(entity) }}
    />
  )}
  ```
- [ ] Add ghost badges for missing properties
- [ ] Handle hover state for ghost badges

### 7. Dialog Integration
- [ ] Add entity type to `DialogContext`
- [ ] Create dialog components for entity properties
- [ ] Wire up dialog open functions
- [ ] Handle dialog save/cancel actions

### 8. ListView Integration
- [ ] Create ListView component using `BaseListView`
- [ ] Configure header rendering
- [ ] Configure empty state
- [ ] Add to view registry (if using views)
- [ ] Add to routing (if needed)

### 9. Testing
- [ ] Test inline editing (Enter, Shift+Enter, Tab, Escape)
- [ ] Test keyboard shortcuts
- [ ] Test optimistic updates (immediate UI + eventual sync)
- [ ] Test focus management (arrow keys, scroll)
- [ ] Test badge interactions
- [ ] Test multi-list view (collapse/expand)

### 10. Documentation
- [ ] Add entity to architecture docs
- [ ] Document entity-specific shortcuts
- [ ] Add example usage
- [ ] Update this checklist if new patterns emerge

---

## Optimistic Updates: Scalable Pattern

**Core Pattern** (used across all entities):

```tsx
// 1. Hook implementation
export function useOptimisticEntityProperty() {
  const { addEntityUpdate, removeEntityUpdate } = useOptimisticUpdates()
  const action = useEntityAction(api.entity.updateProperty, { ... })

  return async (entityId: string, newValue: unknown) => {
    // Immediate UI update
    flushSync(() => {
      addEntityUpdate({
        entityId,
        type: "property-change",
        newValue,
        timestamp: Date.now()
      })
    })

    // Background API call
    const result = await action({ entityId, newValue })

    // Only clear on failure (success clears via useEffect in component)
    if (result === null) {
      removeEntityUpdate(entityId)
    }
  }
}

// 2. Component usage
const optimisticUpdate = getEntityUpdate(entity.id)
const displayValue = optimisticUpdate?.type === "property-change"
  ? optimisticUpdate.newValue
  : entity.propertyValue

// 3. Cleanup when DB syncs
useEffect(() => {
  if (optimisticUpdate?.type === "property-change" &&
      entity.propertyValue === optimisticUpdate.newValue) {
    removeEntityUpdate(entity.id)
  }
}, [entity.propertyValue, optimisticUpdate])
```

**Why this scales:**
- Same pattern for all properties
- Easy to add new properties
- Automatic cleanup via useEffect
- Immediate UI feedback
- Graceful failure handling

---

## Keyboard Shortcuts: Scalable Pattern

**Core Pattern** (used across all entities):

```tsx
export function useEntityDialogShortcuts(focusedEntity: Entity | null) {
  const dialogs = useDialogContext()

  useEffect(() => {
    if (!focusedEntity) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Always skip if in input/textarea
      const target = e.target
      if (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement) {
        return
      }

      // Inline editing shortcuts
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        const element = document.querySelector(
          `[data-entity-id="${getEntityId(focusedEntity)}"]`
        ) as HTMLElement & { startEditing?: () => void; startEditingDescription?: () => void }

        if (e.shiftKey) {
          element?.startEditingDescription?.()
        } else {
          element?.startEditing?.()
        }
        return
      }

      // Property shortcuts (consistent across all entities)
      const shortcutMap = {
        'p': () => dialogs.openPriority(focusedEntity),
        '#': () => dialogs.openProject(focusedEntity),
        '@': () => dialogs.openLabel(focusedEntity),
        // Entity-specific shortcuts below
      }

      const handler = shortcutMap[e.key]
      if (handler && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        handler()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusedEntity, dialogs])
}
```

**Consistent shortcuts across all entities:**
- `Enter` - Edit name/content
- `Shift+Enter` - Edit description
- `p` - Priority dialog
- `#` - Project dialog
- `@` - Label dialog

**Entity-specific shortcuts** (add as needed):
- Tasks: `s` (schedule), `D` (deadline), `c` (complete), `Delete` (delete)
- Projects: `e` (archive)
- Routines: `f` (frequency), `t` (time), etc.

---

## Questions for Discussion

1. ✅ **Editing Strategy**: Standardize on inline editing for name/description across all entities

2. ✅ **Badge System**: Badges are pure view components, entities map data to props

3. **TypeScript Generics**: How strict should our typing be? Trade-off between type safety and flexibility.

4. ✅ **Migration Timeline**: Phase by phase, incremental migration

5. **New Entity Types**: What other entity types are we planning? (to inform API design)

6. ✅ **Optimistic Updates**: Pattern documented in checklist, hooks remain separate per entity

7. ✅ **Keyboard Shortcuts**: Pattern documented in checklist, hooks remain separate per entity

8. **Testing Strategy**: How do we ensure the refactor doesn't break existing behavior?

---

## Recommendations

### High Priority (Do First)

1. **Extract common hooks** (Phase 1)
   - Low risk, immediate benefit
   - Makes codebase cleaner right away
   - No visual changes

2. **Standardize badge system** (Phase 2)
   - Medium risk, high value
   - Easier to add new badge types
   - Consistent visual language

### Medium Priority (Do Second)

3. **Create BaseListItem** (Phase 3)
   - High risk, but high reward
   - Do incrementally (one entity type at a time)
   - Enable easier addition of new entity types

### Low Priority (Consider Later)

4. **Create BaseListView** (Phase 4)
   - High risk, medium reward
   - List wrappers are already fairly similar
   - Could wait until we add more entity types

---

## Appendix: File Locations

### Current Implementation

**Tasks:**
- `app/src/components/TaskListView.tsx`
- `app/src/hooks/useTaskDialogShortcuts.ts`
- `app/src/hooks/useOptimisticTaskText.ts`
- `app/src/hooks/useOptimisticTaskComplete.ts`
- `app/src/hooks/useOptimisticLabelChange.ts`
- `app/src/hooks/useOptimisticDueChange.ts`
- `app/src/hooks/useOptimisticDeadlineChange.ts`

**Projects:**
- `app/src/components/ProjectRow.tsx`
- `app/src/components/ProjectsListView.tsx`
- `app/src/hooks/useProjectDialogShortcuts.ts`
- `app/src/hooks/useOptimisticProjectName.ts`
- `app/src/hooks/useOptimisticProjectDescription.ts`
- `app/src/hooks/useOptimisticProjectPriority.ts`

**Routines:**
- `app/src/components/RoutineRow.tsx`
- `app/src/components/RoutinesListView.tsx`
- `app/src/components/badges/RoutineBadges.tsx`
- `app/src/hooks/useRoutineDialogShortcuts.ts`
- `app/src/hooks/useOptimisticRoutinePriority.ts`
- `app/src/hooks/useOptimisticRoutineProject.ts`
- `app/src/hooks/useOptimisticRoutineLabels.ts`

### Proposed Structure

```
app/src/
├── components/
│   ├── list-items/
│   │   ├── BaseListItem.tsx
│   │   ├── BaseListView.tsx
│   │   ├── TaskListItem.tsx
│   │   ├── ProjectListItem.tsx
│   │   └── RoutineListItem.tsx
│   ├── badges/
│   │   ├── PriorityBadge.tsx
│   │   ├── ProjectBadge.tsx
│   │   ├── LabelBadge.tsx
│   │   ├── DateBadge.tsx
│   │   └── [other badges...]
│   ├── TaskListView.tsx (wrapper)
│   ├── ProjectsListView.tsx (wrapper)
│   └── RoutinesListView.tsx (wrapper)
├── hooks/
│   ├── list-items/
│   │   ├── useListItemFocus.ts
│   │   ├── useListItemHover.ts
│   │   ├── useListItemEditing.ts
│   │   └── useOptimisticSync.ts
│   └── [entity-specific hooks remain separate]
```

---

## Next Steps

1. **Review this document** with the team
2. **Discuss questions** and priorities
3. **Approve migration strategy**
4. **Start with Phase 1** (extract hooks)
5. **Test thoroughly** at each phase
6. **Iterate based on learnings**
