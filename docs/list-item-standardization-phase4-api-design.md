# BaseListView API Design - Phase 4 Milestone 1

**Created**: 2025-01-17 (Plan Resume Session)
**Status**: Design Complete - Ready for Review
**Next Step**: Milestone 2 - Implementation

---

## 📋 Pattern Analysis Summary

After analyzing TaskListView, ProjectsListView, and RoutinesListView (799 lines total), I identified 8 core patterns that can be abstracted into BaseListView:

### Shared Patterns (100% identical across all three)
1. **Props Interface** - Same structure for all entity types
2. **Header Rendering** - Multi-list view header (icon, title, description, count, collapse button)
3. **Compact View** - Dismissed/empty lists show minimal header only
4. **Empty State** - Use `list.getEmptyState()` for entity-specific messages
5. **Loading State** - Generic loading indicator
6. **Expand/Collapse Logic** - `isExpanded` state management, multi-list vs single view
7. **Count Tracking** - Registry lookup + count change callbacks
8. **Focus Management** - useListItemFocus hook integration + FocusContext update

### Entity-Specific (handled by parent wrapper)
- **Entity Data Fetching** - Queries are entity-specific (getItems, getProjects, getRoutines)
- **Sorting/Filtering** - Projects apply priority sorting, Tasks apply maxTasks slice
- **Extra Features** - Routines has "New Routine" button + dialogs
- **Render Row** - Each entity type needs custom rendering (TaskListItem vs ProjectListItem vs RoutineListItem)
- **Shortcuts Hook** - Entity-specific keyboard shortcuts (useTaskDialogShortcuts vs useProjectDialogShortcuts)

---

## 🎯 BaseListView<T> API Specification

### Generic Type Parameter
```typescript
// Type parameter T represents the entity type
// Each usage specifies exact type: BaseListView<TodoistTaskWithProject>
// Enables full TypeScript autocomplete in callbacks
```

### Props Interface

```typescript
export interface BaseListViewProps<T> {
  // ============= ENTITY CONFIGURATION =============

  /**
   * Array of entities to render
   * Example: tasks, projects, routines
   */
  entities: T[]

  /**
   * Entity type identifier ("task" | "project" | "routine" | custom)
   * Used in data attributes for DOM identification
   * Passed to useListItemFocus for accessibility
   */
  entityType: string

  /**
   * Function to extract unique ID from entity
   * Used as React key and for data attributes
   * Example: (task) => task.todoist_id
   * Example: (project) => project.todoist_id
   * Example: (routine) => routine._id
   */
  getEntityId: (entity: T) => string

  // ============= RENDER PROPS =============

  /**
   * Render function for each entity row
   * Returns fully rendered row component (TaskListItem, ProjectListItem, etc.)
   *
   * @param entity Current entity to render
   * @param index Position in entities array (used for focus management)
   * @param onElementRef Callback to register element ref for focus management
   *
   * Example:
   * renderRow={(task, index, ref) => (
   *   <TaskListItem
   *     task={task}
   *     onElementRef={ref}
   *     onClick={() => onEntityClick(list.id, index)}
   *   />
   * )}
   */
  renderRow: (entity: T, index: number, onElementRef: (el: HTMLDivElement | null) => void) => React.ReactNode

  // ============= LIST CONFIGURATION =============

  /**
   * ListInstance from views system
   * Provides header, empty state, and configuration
   * Must have: getHeader(), getEmptyState(), startExpanded, collapsible, maxTasks
   */
  list: ListInstance

  /**
   * Parent callback: called when visible entity count changes
   * Used to update counts in sidebar/parent UI
   *
   * @param listId Unique identifier of this list (list.id)
   * @param count Number of visible entities (respects maxTasks limit)
   *
   * Example: (listId, count) => updateListCount(listId, count)
   */
  onEntityCountChange?: (listId: string, count: number) => void

  /**
   * Parent callback: called when entity is clicked
   * Used to handle item interactions, open detail views, etc.
   *
   * @param listId Unique identifier of this list
   * @param index Index of clicked entity in visible array
   *
   * Example: (listId, index) => openDetailView(listId, index)
   */
  onEntityClick?: (listId: string, entityIndex: number) => void

  // ============= FOCUS MANAGEMENT =============

  /**
   * Current focused entity index (from parent state)
   * Parent manages this via useState + FocusContext
   * Used by useListItemFocus for keyboard navigation
   *
   * Null or -1 means no entity is focused
   * Must be in range [0, entities.length-1] or will be ignored
   */
  focusedIndex: number | null

  /**
   * Callback to update focused entity in parent
   * Called when user navigates with arrow keys
   * Parent should update its state and re-render with new focusedIndex
   *
   * Example: (newIndex: number) => setFocusedTaskIndex(newIndex)
   */
  setFocusedEntity: (index: number | null) => void

  /**
   * Hook that provides entity-specific keyboard shortcuts
   * Called with currently focused entity
   * Hook manages dialog opening, priority changes, etc.
   *
   * Example: useTaskDialogShortcuts, useProjectDialogShortcuts
   *
   * Type: (entity: T) => void
   * Parent passes already-bound hook
   */
  useEntityShortcuts: (entity: T | null) => void

  /**
   * Callback for focus context update
   * Called when focused entity changes (focusedIndex is valid)
   * Updates global FocusContext for cross-component coordination
   *
   * Example: (task: TodoistTaskWithProject) => setFocusedTask(task)
   */
  setFocusedEntityInContext?: (entity: T | null) => void

  // ============= MULTI-LIST VIEW OPTIONS =============

  /**
   * Whether this is part of a multi-list view (App.tsx) or standalone (single view page)
   * Affects header visibility, expand/collapse UI, empty state display
   *
   * - true: Show header, collapse/expand buttons, minimal empty state
   * - false: No header, full empty state message, always show entities (if not loading)
   */
  isMultiListView?: boolean

  /**
   * Whether this list is currently dismissed (collapsed in multi-list view)
   * Only used when isMultiListView={true}
   *
   * true = Show compact view (header only, no entities)
   * false = Show full view (header + entities)
   *
   * Parent manages this via state + onDismiss/onRestore callbacks
   */
  isDismissed?: boolean

  /**
   * Callback: user clicked collapse button (X icon)
   * Parent should update local state to collapse this list
   *
   * @param listId Unique identifier of this list
   *
   * Example: (listId) => setDismissedLists({ ...dismissed, [listId]: true })
   */
  onDismiss?: (listId: string) => void

  /**
   * Callback: user clicked expand button (RotateCcw icon)
   * Parent should update local state to expand this list
   *
   * @param listId Unique identifier of this list
   *
   * Example: (listId) => setDismissedLists({ ...dismissed, [listId]: false })
   */
  onRestore?: (listId: string) => void

  // ============= LOADING STATE =============

  /**
   * Whether data is still loading
   * When true, show loading indicator instead of empty/full view
   *
   * Example: isLoading={entities === undefined}
   * Example: isLoading={tasks === undefined}
   */
  isLoading?: boolean

  // ============= OPTIONAL STYLING =============

  /**
   * Additional className for wrapper div
   * Applied to outer container
   */
  className?: string
}
```

---

## 🔄 Focus Management Pattern

### Parent Setup
```typescript
// In TaskListView wrapper
function TaskListView({ list, onTaskCountChange, ... }) {
  const [focusedTaskIndex, setFocusedTaskIndex] = useState<number | null>(null)
  const { setFocusedTask } = useFocusContext()

  const handleTaskClick = useCallback((listId: string, index: number) => {
    setFocusedTaskIndex(index)
  }, [])

  return (
    <BaseListView
      entities={tasks}
      focusedIndex={focusedTaskIndex}
      setFocusedEntity={setFocusedTaskIndex}
      setFocusedEntityInContext={setFocusedTask}
      useEntityShortcuts={useTaskDialogShortcuts}
      onEntityClick={handleTaskClick}
      // ... other props
    />
  )
}
```

### Focus Management Internals
```
User presses Down Arrow
         ↓
useListItemFocus detects key press
         ↓
Calls setFocusedEntity(newIndex)
         ↓
Parent state updates, re-renders with new focusedIndex
         ↓
BaseListView receives new focusedIndex prop
         ↓
useEffect checks if valid entity at focusedIndex
         ↓
Calls setFocusedEntityInContext(entity) to update global state
         ↓
Calls useEntityShortcuts(entity) to enable keyboard shortcuts
         ↓
Component re-renders with new focused styling
```

---

## 📊 Header Rendering Logic

### Single View (isMultiListView={false})
```
No header rendering
Just show entities (if not loading)
```

### Multi-List View - Full Display (isMultiListView={true}, isDismissed={false})
```
┌─────────────────────────────────────────┐
│ 📋 Tasks    Showing 10 of 24          X │  ← Header
├─────────────────────────────────────────┤
│ [Task 1]                                 │
│ [Task 2]                                 │
│ [Task 3]                                 │
│ ...                                      │
└─────────────────────────────────────────┘

Header Components:
- Icon: header.icon
- Title: header.title
- Description: header.description (optional)
- Count Badge: "Showing X of Y" or just total count
- Collapse Button: X icon, onClick={() => onDismiss(list.id)}
```

### Multi-List View - Compact (isMultiListView={true}, isDismissed={true} OR visibleEntities.length === 0)
```
┌──────────────────────────────┐
│ 📋 Tasks              24   🔄 │  ← Compact header (much smaller)
└──────────────────────────────┘

Components:
- Icon: header.icon
- Title: header.title (no description)
- Count Badge: Just the number
- Expand Button: RotateCcw icon, onClick={() => onRestore(list.id)}
- No entity rows shown
```

---

## 🎯 Count Tracking

### Count Sources
1. **Visible Count**: Actual entities rendered (`entities.length` respecting maxTasks)
2. **Total Count**: From CountRegistry (all entities, not respecting maxTasks)

### Display Rules
```typescript
// In header badge
const totalCount = registry.getCountForList(list.id, list.query)

if (list.maxTasks && visibleCount < totalCount) {
  // Show "Showing X of Y" when limiting results
  badge = `Showing ${visibleCount} of ${totalCount}`
} else {
  // Show just total count
  badge = `${totalCount}`
}

// Report visible count to parent
onEntityCountChange?.(list.id, visibleCount)
```

### Callback Timing
- Called in useEffect whenever `entities.length` changes
- Parent uses this to update sidebar counts
- Should be called even if count is 0

---

## 🔧 Technical Decisions

### Decision 1: Parent Manages Focus State
**Rationale**:
- Multi-list views coordinate focus across multiple BaseListView instances
- Parent (App.tsx) has entity-specific focus state in FocusContext
- Parent can programmatically set focus (after creating new entity, etc.)
- Keeps BaseListView pure (receives props, doesn't manage app state)
- Consistent with BaseListItem pattern (Phase 3)

**Trade-off**: Parent has more code (acceptable - it's thin wrapper around BaseListView)

### Decision 2: Header from list.getHeader()
**Rationale**:
- All current views use identical header layout
- Header data already abstracted in ListInstance
- Consistent with how other list-level data is provided
- Reduces parent code significantly
- If header customization needed later, can add renderHeader prop

**Trade-off**: No header customization (acceptable - headers are consistent)

### Decision 3: Count from Registry
**Rationale**:
- Registry already tracks all entities across all list types
- Parent has access to registry via context
- Separates displayed count from total count
- Enables "Showing X of Y" when maxTasks applied

**Trade-off**: Requires parent to pass registry.getCountForList result (can be abstracted in parent wrapper)

### Decision 4: Hooks Provided as Props
**Rationale**:
- Each entity type has specific shortcuts (useTaskDialogShortcuts vs useProjectDialogShortcuts)
- Allows parent to control keyboard behavior
- Keeps BaseListView agnostic to entity type
- Same pattern used in BaseListItem (Phase 3)

**Trade-off**: Parent must pass correctly bound hook (prevents bugs if wrong hook passed)

### Decision 5: renderRow Returns Full Component
**Rationale**:
- BaseListView only cares about list-level concerns (header, empty state, collapse)
- Row rendering is entity-specific responsibility (TaskListItem, ProjectListItem, etc.)
- Same pattern used in BaseListItem (already exists and working)
- Cleaner separation of concerns

**Trade-off**: Parent must render ListItem component (minimal boilerplate)

---

## 📝 Usage Examples

### Example 1: Tasks (Current TaskListView)
```typescript
export function TaskListView({
  list,
  onTaskCountChange,
  onTaskClick,
  focusedTaskIndex,
  isDismissed = false,
  onDismiss,
  onRestore,
  isMultiListView = false
}: TaskListViewProps) {
  const [focusedTaskIndex, setFocusedTaskIndex] = useState<number | null>(null)
  const { setFocusedTask } = useFocusContext()
  const { registry } = useCountRegistry()

  // Fetch tasks (same as current)
  const tasks = useQuery(...)
  const visibleTasks = list.maxTasks ? tasks.slice(0, list.maxTasks) : tasks

  return (
    <BaseListView<TodoistTaskWithProject>
      entities={visibleTasks}
      entityType="task"
      getEntityId={(task) => task.todoist_id}

      list={list}
      isMultiListView={isMultiListView}
      isDismissed={isDismissed}
      onDismiss={onDismiss}
      onRestore={onRestore}
      isLoading={tasks === undefined}

      focusedIndex={focusedTaskIndex}
      setFocusedEntity={setFocusedTaskIndex}
      setFocusedEntityInContext={setFocusedTask}
      useEntityShortcuts={useTaskDialogShortcuts}

      onEntityCountChange={onTaskCountChange}
      onEntityClick={onTaskClick}

      renderRow={(task, index, ref) => (
        <TaskListItem
          key={task._id}
          task={task}
          onElementRef={ref}
          onClick={() => onTaskClick?.(list.id, index)}
          // ... other task-specific props
        />
      )}
    />
  )
}
```

### Example 2: Projects (Current ProjectsListView)
```typescript
export function ProjectsListView({
  list,
  onProjectCountChange,
  onProjectClick,
  focusedProjectIndex,
  isDismissed = false,
  onDismiss,
  onRestore,
  isMultiListView = false
}: ProjectsListViewProps) {
  const [focusedProjectIndex, setFocusedProjectIndex] = useState<number | null>(null)
  const { setFocusedProject } = useFocusContext()
  const { registry } = useCountRegistry()

  // Fetch projects and apply sorting (entity-specific)
  const projects = useMemo(() => {
    if (!allProjects) return []
    return allProjects
      .filter((p) => !p.is_deleted)
      .sort((a, b) => {
        // Priority sorting logic (kept in parent wrapper)
        // ...
      })
  }, [allProjects, ...])

  const visibleProjects = list.maxTasks ? projects.slice(0, list.maxTasks) : projects

  return (
    <BaseListView<TodoistProjectWithMetadata>
      entities={visibleProjects}
      entityType="project"
      getEntityId={(project) => project.todoist_id}

      list={list}
      isMultiListView={isMultiListView}
      isDismissed={isDismissed}
      onDismiss={onDismiss}
      onRestore={onRestore}
      isLoading={allProjects === undefined}

      focusedIndex={focusedProjectIndex}
      setFocusedEntity={setFocusedProjectIndex}
      setFocusedEntityInContext={setFocusedProject}
      useEntityShortcuts={useProjectDialogShortcuts}

      onEntityCountChange={onProjectCountChange}
      onEntityClick={onProjectClick}

      renderRow={(project, index, ref) => (
        <ProjectListItem
          key={project._id}
          project={project}
          onElementRef={ref}
          onClick={() => onProjectClick?.(list.id, index)}
        />
      )}
    />
  )
}
```

### Example 3: Routines (Refactored with DialogContext)
```typescript
export function RoutinesListView({
  list,
  onRoutineCountChange,
  onRoutineClick,
  focusedRoutineIndex,
  isMultiListView = false
}: RoutinesListViewProps) {
  const [focusedRoutineIndex, setFocusedRoutineIndex] = useState<number | null>(null)
  const { setFocusedRoutine } = useFocusContext()
  const { registry } = useCountRegistry()
  const { openRoutineCreate } = useDialogContext()

  // Fetch routines
  const routines = useQuery(...)
  const visibleRoutines = list.maxTasks ? routines.slice(0, list.maxTasks) : routines

  return (
    <>
      {/* "New Routine" button stays in parent wrapper */}
      <Button onClick={() => openRoutineCreate()}>
        <Plus className="h-4 w-4" />
        New Routine
      </Button>

      {/* BaseListView handles list-level concerns only */}
      <BaseListView<Doc<"routines">>
        entities={visibleRoutines}
        entityType="routine"
        getEntityId={(routine) => routine._id}

        list={list}
        isMultiListView={isMultiListView}
        isDismissed={isDismissed}
        onDismiss={onDismiss}
        onRestore={onRestore}
        isLoading={routines === undefined}

        focusedIndex={focusedRoutineIndex}
        setFocusedEntity={setFocusedRoutineIndex}
        setFocusedEntityInContext={setFocusedRoutine}
        useEntityShortcuts={useRoutineDialogShortcuts}

        onEntityCountChange={onRoutineCountChange}
        onEntityClick={onRoutineClick}

        renderRow={(routine, index, ref) => (
          <RoutineListItem
            key={routine._id}
            routine={routine}
            onElementRef={ref}
            onClick={() => onRoutineClick?.(list.id, index)}
            // ✅ No onOpenDetail/onOpenEdit needed!
            // DetailsBadge and EditBadge use DialogContext directly
          />
        )}
      />
    </>
  )
}
```

**Key improvements:**
- Dialogs are managed by DialogManager (centralized)
- RoutineListItem calls `openRoutineDetail(routineId)` and `openRoutineEdit(routineId)` directly via DialogContext
- No local dialog state in wrapper
- No callback prop drilling
- Consistent with TaskListItem and ProjectListItem patterns

---

## 🏗️ Component Structure (Rendering)

```
<BaseListView<T>>
├─ [LOADING STATE]
│  └─ <div> Loading {entityType}s... </div>
│
├─ [MULTI-LIST COMPACT VIEW] (if isDismissed || visibleEntities.length === 0)
│  └─ <div className="max-w-4xl mx-auto px-6 py-2">
│     ├─ <Icon /> header.icon
│     ├─ <span> header.title </span>
│     ├─ <Badge> count </Badge>
│     └─ <Button> expand (RotateCcw) </Button>
│
├─ [FULL VIEW] (default)
│  └─ <div className="max-w-4xl mx-auto px-6 py-{0|4}">
│     ├─ [HEADER] (only if isMultiListView)
│     │  ├─ <Icon /> header.icon
│     │  ├─ <h2> header.title </h2>
│     │  ├─ <p> header.description </p>
│     │  ├─ <Badge> count </Badge>
│     │  └─ <Button> collapse (X) </Button>
│     │  └─ <Separator />
│     │
│     └─ [ENTITY LIST] (if isExpanded || !isMultiListView)
│        ├─ (if visibleEntities.length > 0)
│        │  └─ <div className="space-y-1">
│        │     ├─ renderRow(entity[0], 0, ref)
│        │     ├─ renderRow(entity[1], 1, ref)
│        │     └─ ...
│        │
│        └─ (else empty state)
│           └─ [EMPTY STATE]
│              ├─ (if isMultiListView && collapsible)
│              │  └─ <div> No {entityType}s </div>
│              └─ (else)
│                 ├─ <p> emptyState.title </p>
│                 └─ <p> emptyState.description </p>
```

---

## ✅ Success Criteria for Implementation (Milestone 2)

- [ ] BaseListView<T> compiles with zero TypeScript errors
- [ ] All generic type parameters work correctly
- [ ] Header renders correctly (single vs multi-list)
- [ ] Compact view renders correctly (dismissed/empty)
- [ ] Empty state renders correctly (both variants)
- [ ] Loading state renders correctly
- [ ] Collapse/expand buttons work (onDismiss/onRestore callbacks fired)
- [ ] Count badge displays correctly
- [ ] Focus management integrated correctly (useListItemFocus)
- [ ] Entity click handler works (onEntityClick fired)
- [ ] Entity count change callback works (onEntityCountChange fired)
- [ ] Data attributes set correctly (data-task-id, data-project-id, etc.)
- [ ] renderRow receives correct parameters (entity, index, ref)
- [ ] Expand button on compact view works (onRestore fired)
- [ ] isExpanded state syncs with isDismissed prop
- [ ] Multi-list view spacing and styling consistent with current views
- [ ] Single view mode works (no header, always expanded)

---

## 🔗 Phase 4 Milestones (Updated)

**Milestone 1**: API Design ✅
- Complete API specification
- Usage examples for all three entity types
- Technical decision documentation
- Ready for implementation review

**Milestone 2**: Implement BaseListView Component
- Create component file
- Implement all rendering paths
- Integrate focus management
- Full TypeScript typing

**Milestone 3**: Refactor TaskListView
- Replace ListView logic with BaseListView
- Verify identical behavior

**Milestone 4**: Refactor ProjectsListView
- Replace ListView logic with BaseListView
- Verify identical behavior

**Milestone 5**: Refactor RoutinesListView
- Move RoutineDialog/RoutineDetailDialog to DialogManager
- Add `openRoutineCreate`, `openRoutineDetail`, `openRoutineEdit` to DialogContext
- Update DetailsBadge/EditBadge in RoutineListItem to use DialogContext directly
- Remove onOpenDetail/onOpenEdit callback props from RoutineListItem
- Remove local dialog state from RoutinesListView wrapper
- Replace ListView logic with BaseListView
- Verify identical behavior

**Milestone 6**: Final Validation & Documentation
- Run full validation suite
- Verify code reduction metrics
- Update documentation

---

## 🎯 Bonus: DialogContext Pattern for RoutineDialog

As part of Milestone 5, we'll fix an inconsistency: RoutineListItem currently uses callback drilling instead of DialogContext like all other list items.

### Current Pattern (INCONSISTENT)
```typescript
// RoutinesListView passes callbacks down
<RoutineListItem
  onOpenDetail={handleOpenDetail}
  onOpenEdit={handleOpenEdit}
/>

// RoutineListItem receives and calls them
const RoutineListItem = ({ onOpenDetail, onOpenEdit }) => {
  return (
    <DetailsBadge onClick={() => onOpenDetail?.(routine)} />
    <EditBadge onClick={() => onOpenEdit?.(routine)} />
  )
}
```

### New Pattern (CONSISTENT with Tasks & Projects)
```typescript
// DialogContext provides dialog openers
const { openRoutineDetail, openRoutineEdit, openRoutineCreate } = useDialogContext()

// RoutineListItem calls DialogContext directly
const RoutineListItem = ({ routine }) => {
  return (
    <DetailsBadge onClick={() => openRoutineDetail(routine._id)} />
    <EditBadge onClick={() => openRoutineEdit(routine._id)} />
  )
}

// RoutinesListView just uses DialogContext for New button
<Button onClick={() => openRoutineCreate()}>New Routine</Button>
```

### Changes Required

1. **DialogContext** (`app/src/contexts/DialogContext.tsx`)
   - Add `openRoutineCreate: () => void`
   - Add `openRoutineDetail: (routineId: string) => void`
   - Add `openRoutineEdit: (routineId: string) => void`

2. **DialogManager** (`app/src/components/dialogs/DialogManager.tsx`)
   - Add RoutineDialog rendering (create/edit mode)
   - Add RoutineDetailDialog rendering
   - Handle dialog state based on dialogType

3. **RoutineListItem** (`app/src/components/list-items/RoutineListItem.tsx`)
   - Remove `onOpenDetail` and `onOpenEdit` props
   - Call `openRoutineDetail(routine._id)` and `openRoutineEdit(routine._id)` directly

4. **RoutinesListView** (`app/src/components/RoutinesListView.tsx`)
   - Remove local dialog state (isDialogOpen, isDetailDialogOpen, selectedRoutine)
   - Remove dialog JSX (RoutineDialog, RoutineDetailDialog components)
   - Call `openRoutineCreate()` from New button

**Result**: Much cleaner code, no callback drilling, consistent with rest of app.

---

## 📚 References

**Current Implementation** (lines to refactor):
- TaskListView.tsx (287 lines) - Header/empty/collapse logic: lines 142-284
- ProjectsListView.tsx (267 lines) - Header/empty/collapse logic: lines 133-266
- RoutinesListView.tsx (245 lines) - Header logic: lines 135-243

**Related Files**:
- `app/src/lib/views/types.ts` - ListInstance type definition
- `app/src/hooks/list-items/useListItemFocus.ts` - Focus hook
- `app/src/components/list-items/TaskListItem.tsx` - Row component
- `app/src/components/list-items/ProjectListItem.tsx` - Row component
- `app/src/components/list-items/RoutineListItem.tsx` - Row component

**Similar Patterns**:
- BaseListItem<T> (Phase 3) - Uses render props + generics
- useListItemFocus (Phase 1) - Focus management
- ListInstance.getHeader() - Header data abstraction

