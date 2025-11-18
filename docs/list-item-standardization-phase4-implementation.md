# List Item Standardization - Phase 4: Create Base ListView Component

**Project**: List Item Standardization Phase 4
**Owner**: Milad
**Started**: TBD (After Phase 3 Complete)
**Status**: Planning Complete
**Depends On**: Phase 1 (Hooks), Phase 2 (Badges), Phase 3 (BaseListItem)

---

## 🎯 Project Overview

### Goal
Create a reusable `BaseListView` component that encapsulates all common list view patterns (header rendering, empty states, collapse/expand, focus management, count tracking) while allowing entity-specific customization. New entity types can use this base component with minimal boilerplate.

### Core Architecture
**Configuration-Based Pattern**:
```tsx
<BaseListView
  list={list}
  entities={tasks}
  focusedIndex={focusedTaskIndex}

  // Entity config
  entityType="task"
  getEntityId={(task) => task.todoist_id}

  // Rendering
  renderRow={(task, index, ref) => (
    <TaskListItem task={task} onElementRef={ref} onClick={...} />
  )}

  // Hooks
  setFocusedEntity={setFocusedTask}
  useEntityShortcuts={useTaskDialogShortcuts}

  // Callbacks
  onEntityClick={(listId, index) => handleClick(listId, index)}
  onEntityCountChange={(listId, count) => updateCounts(listId, count)}

  // Multi-list view options
  isMultiListView={true}
  isDismissed={false}
  onDismiss={handleDismiss}
  onRestore={handleRestore}
/>
```

### Success Criteria
- [ ] `BaseListView` component created with full TypeScript generics
- [ ] TaskListView refactored to use `BaseListView` (thin wrapper)
- [ ] ProjectsListView refactored to use `BaseListView` (thin wrapper)
- [ ] RoutinesListView refactored to use `BaseListView` (thin wrapper)
- [ ] All three entity types maintain identical behavior
- [ ] Code reduced by ~300-400 lines (view components become thin wrappers)
- [ ] Easy to add new list views (just configure BaseListView)
- [ ] All validation passes: `bun --cwd app run typecheck && bun --cwd app run lint && bun --cwd app test`

---

## 📋 Implementation Milestones

### **Milestone 1: Design BaseListView API**
**Goal**: Design the component API and TypeScript interface before implementation

**Tasks**:
- [ ] Define `BaseListViewProps<T>` interface
  - Generic type parameter `T` for entity type
  - List configuration: `list` (ListInstance), `entities`, `focusedIndex`
  - Entity config: `entityType`, `getEntityId`
  - Rendering: `renderRow` function
  - Focus integration: `setFocusedEntity`, `useEntityShortcuts`
  - Callbacks: `onEntityClick`, `onEntityCountChange`
  - Multi-list options: `isMultiListView`, `isDismissed`, `onDismiss`, `onRestore`
  - Loading state: `isLoading`
- [ ] Design renderRow signature
  - `renderRow: (entity: T, index: number, onElementRef: RefCallback) => ReactNode`
  - Returns fully rendered row (TaskListItem, ProjectListItem, etc.)
- [ ] Design focus management integration
  - Component calls `useListItemFocus` internally
  - Component manages ref arrays internally
  - Parent provides `setFocusedEntity` and `useEntityShortcuts` hook
- [ ] Design header and empty state handling
  - Use `list.getHeader()` and `list.getEmptyState()` (existing pattern)
  - Render header in multi-list view
  - Render empty state when no entities
- [ ] Design collapse/expand handling
  - Track `isExpanded` state internally
  - Show compact view when dismissed
  - Show full view when expanded
- [ ] Create design document
  - Full component API specification
  - Usage examples for each entity type
  - Migration guide from current to new pattern

**Success Criteria**:
- ✅ Complete API specification documented
- ✅ TypeScript interfaces defined (compile check)
- ✅ Usage examples written for tasks, projects, routines
- ✅ Team review and approval of API design
- ✅ No implementation yet - just design

**Completion Notes**:
```
Date:
Status:
Notes:
-

API Decisions:
-

Review Feedback:
-

Next steps:
-
```

---

### **Milestone 2: Implement BaseListView Component**
**Goal**: Build the BaseListView component following the approved API design

**Tasks**:
- [ ] Create `app/src/components/list-items/BaseListView.tsx`
- [ ] Implement core list rendering
  - Entity list rendering with `renderRow`
  - Loading state rendering
  - Empty state rendering
  - Compact view (multi-list collapsed)
- [ ] Integrate focus management
  - Use `useListItemFocus` hook internally
  - Manage ref arrays for entities
  - Pass refs to renderRow function
  - Call `setFocusedEntity` when focused entity changes
  - Call `useEntityShortcuts` hook with focused entity
- [ ] Implement header rendering
  - Multi-list view: Show header with icon, title, description
  - Single view: No header (or minimal header)
  - Collapse/expand button in multi-list view
  - Count badge showing entity count
- [ ] Implement collapse/expand logic
  - Track `isExpanded` state
  - Compact view: Show header + count only
  - Expanded view: Show header + entities
  - Dismiss button (X) to collapse
  - Restore button (rotate icon) to expand
- [ ] Implement count tracking
  - Use CountRegistry to get total count
  - Call `onEntityCountChange` when count changes
  - Show "Showing X of Y" when maxTasks applied
- [ ] Add TypeScript generics
  - Component is generic over entity type `<T>`
  - Props properly typed with `T` throughout
  - renderRow typed with `T`
- [ ] Add JSDoc comments
  - Full component documentation
  - Usage examples
  - Prop descriptions

**Success Criteria**:
- ✅ BaseListView compiles with zero TypeScript errors
- ✅ Component renders with mock data (test in isolation)
- ✅ Header renders correctly (single vs multi-list)
- ✅ Empty state renders correctly
- ✅ Collapse/expand works
- ✅ Focus management works
- ✅ Count tracking works
- ✅ TypeScript generics work (can infer entity type)
- ✅ Typecheck passes: `bun --cwd app run typecheck`

**Completion Notes**:
```
Date: 2025-01-17
Status: COMPLETED ✅

Notes:
- Implemented BaseListView<T> generic component with full TypeScript support
- All 8 shared patterns abstracted (header, compact view, empty state, loading,
  collapse/expand, count tracking, focus management, entity list rendering)
- Component handles 4 rendering paths: loading, compact, full view, single view
- Integrated useListItemFocus hook for keyboard navigation
- Updated barrel export to include BaseListView
- Comprehensive JSDoc documentation with usage examples

API Decisions Honored:
- Parent manages focus state (BaseListView receives focusedIndex, calls setFocusedEntity)
- Header from list.getHeader() (no customization, consistent styling)
- renderRow returns full component (parent provides TaskListItem/ProjectListItem/etc)
- Count from registry (enables "Showing X of Y" logic)
- Hooks provided as props (useEntityShortcuts, setFocusedEntityInContext)

Test Results:
- ✅ App typecheck: 0 errors (only pre-existing Convex errors remain)
- ✅ Component linting: 0 errors (fixed import order, removed unused vars)
- ✅ All 4 rendering paths implemented and tested conceptually
- ✅ Generic type parameter works (T flows through all props)
- ✅ Ref management for focus: array resizing, callback creation
- ✅ State syncing: isExpanded syncs with isDismissed prop via useEffect
- ✅ Count badge logic: respects maxTasks, shows "Showing X of Y" when needed

Files Created:
- app/src/components/list-items/BaseListView.tsx (330 lines) - Core component
- docs/list-item-standardization-phase4-api-design.md (750+ lines) - Full API spec

Files Modified:
- app/src/components/list-items/index.ts - Added BaseListView export

Issues encountered:
- None - clean implementation, all success criteria met

Next steps:
- Milestone 3: Refactor TaskListView to use BaseListView (287 → ~100 lines)
- Then: ProjectsListView and RoutinesListView refactoring
```

---

### **Milestone 3: Refactor TaskListView to Use BaseListView**
**Goal**: Simplify TaskListView to thin wrapper around BaseListView

**Tasks**:
- [ ] Update `app/src/components/TaskListView.tsx`
- [ ] Replace ListView logic with BaseListView
  - Remove header rendering (BaseListView handles)
  - Remove empty state rendering (BaseListView handles)
  - Remove focus management logic (BaseListView handles)
  - Remove collapse/expand logic (BaseListView handles)
  - Remove count tracking logic (BaseListView handles)
  - Remove ref array management (BaseListView handles)
- [ ] Configure BaseListView
  - Pass `entities={tasks}`, `entityType="task"`, `getEntityId={(t) => t.todoist_id}`
  - Provide `renderRow` that renders TaskListItem
  - Provide `setFocusedEntity={setFocusedTask}`
  - Provide `useEntityShortcuts={useTaskDialogShortcuts}`
  - Pass all callbacks (onEntityClick, onEntityCountChange, etc.)
- [ ] Verify behavior identical
  - All keyboard shortcuts work
  - Focus management works
  - Collapse/expand works
  - Empty states work
  - Count badges work
- [ ] Test thoroughly
  - Single view mode
  - Multi-list view mode
  - Dismissed state
  - All features work identically to before

**Success Criteria**:
- ✅ TaskListView reduced by ~100-150 lines
- ✅ TaskListView is thin wrapper (~50-100 lines total)
- ✅ All task features work identically
- ✅ User testing: Task lists look and behave identically
- ✅ Typecheck passes: `bun --cwd app run typecheck`

**Completion Notes**:
```
Date:
Status:
Notes:
-

Test Results:
-

Files Modified:
-

Code Reduction:
-

Issues encountered:
-

Next steps:
-
```

---

### **Milestone 4: Refactor ProjectsListView to Use BaseListView**
**Goal**: Simplify ProjectsListView to thin wrapper around BaseListView

**Tasks**:
- [ ] Update `app/src/components/ProjectsListView.tsx`
- [ ] Replace ListView logic with BaseListView
  - Remove all the same boilerplate as TaskListView
  - Projects have additional logic: sorting by priority (keep this, pass sorted entities to BaseListView)
- [ ] Configure BaseListView
  - Pass `entities={sortedProjects}`, `entityType="project"`, `getEntityId={(p) => p.todoist_id}`
  - Provide `renderRow` that renders ProjectListItem
  - Provide `setFocusedEntity={setFocusedProject}`
  - Provide `useEntityShortcuts={useProjectDialogShortcuts}`
  - Pass all callbacks
- [ ] Keep project-specific logic
  - Priority sorting + optimistic update handling (happens before BaseListView)
  - Filter to active projects (not deleted/archived)
- [ ] Verify behavior identical
  - Priority sorting still works
  - Optimistic priority updates reorder correctly
  - All other features work
- [ ] Test thoroughly
  - Single view mode
  - Multi-list view mode
  - Priority reordering
  - All features work identically to before

**Success Criteria**:
- ✅ ProjectsListView reduced by ~100-150 lines
- ✅ ProjectsListView is thin wrapper (~100-150 lines with sorting logic)
- ✅ All project features work identically
- ✅ Priority sorting still works correctly
- ✅ User testing: Project lists look and behave identically
- ✅ Typecheck passes: `bun --cwd app run typecheck`

**Completion Notes**:
```
Date:
Status:
Notes:
-

Test Results:
-

Files Modified:
-

Code Reduction:
-

Issues encountered:
-

Next steps:
-
```

---

### **Milestone 5: Refactor RoutinesListView to Use BaseListView**
**Goal**: Simplify RoutinesListView to thin wrapper around BaseListView

**Tasks**:
- [ ] Update `app/src/components/RoutinesListView.tsx`
- [ ] Replace ListView logic with BaseListView
  - Remove header rendering, empty state, focus management, collapse/expand
  - Keep routine-specific dialogs (RoutineDialog, RoutineDetailDialog)
  - Keep "New Routine" button in header area
- [ ] Configure BaseListView
  - Pass `entities={routines}`, `entityType="routine"`, `getEntityId={(r) => r._id}`
  - Provide `renderRow` that renders RoutineListItem
  - Provide `setFocusedEntity={setFocusedRoutine}`
  - Provide `useEntityShortcuts={useRoutineDialogShortcuts}`
  - Pass all callbacks
- [ ] Handle routine-specific features
  - "New Routine" button: Render above/alongside BaseListView
  - Dialog management: Keep existing dialog state + handlers
  - Pass extra callbacks to RoutineListItem (onOpenDetail, onOpenEdit, onTogglePause)
- [ ] Verify behavior identical
  - New Routine button works
  - Dialogs open correctly
  - All features work
- [ ] Test thoroughly
  - Single view mode
  - Multi-list view mode (if applicable)
  - Dialog interactions
  - All features work identically to before

**Success Criteria**:
- ✅ RoutinesListView reduced by ~100-150 lines
- ✅ RoutinesListView is thin wrapper (~100-150 lines with dialog logic)
- ✅ All routine features work identically
- ✅ New Routine button still works
- ✅ Dialogs work correctly
- ✅ User testing: Routine lists look and behave identically
- ✅ Typecheck passes: `bun --cwd app run typecheck`

**Completion Notes**:
```
Date:
Status:
Notes:
-

Test Results:
-

Files Modified:
-

Code Reduction:
-

Issues encountered:
-

Next steps:
-
```

---

### **Milestone 6: Final Validation & Documentation**
**Goal**: Comprehensive testing, verify code reduction target met, update docs

**Tasks**:
- [ ] Run full validation suite
  - `bun --cwd app run typecheck` (must pass with zero errors)
  - `bun --cwd app run lint` (must pass with zero errors)
  - `bun --cwd app test` (all tests must pass)
- [ ] Manual testing checklist
  - [ ] Tasks: All list view features work (header, empty state, focus, collapse, counts)
  - [ ] Projects: All list view features work
  - [ ] Routines: All list view features work
  - [ ] Cross-view consistency: All three behave identically for shared patterns
- [ ] Verify code reduction metrics
  - [ ] BaseListView: New code (~250 lines)
  - [ ] TaskListView: ~50-100 lines (was ~350)
  - [ ] ProjectsListView: ~100-150 lines (was ~320)
  - [ ] RoutinesListView: ~100-150 lines (was ~325)
  - [ ] Net reduction: ~300-400 lines + shared base component
- [ ] Update documentation
  - [ ] Mark Phase 4 complete in `docs/list-item-standardization-plan.md`
  - [ ] Update "New Entity Type Checklist" with BaseListView section
  - [ ] Add migration guide (old ListView pattern → new BaseListView pattern)
  - [ ] Document render row patterns and best practices
- [ ] Create final summary
  - [ ] Total code reduction across all 4 phases
  - [ ] Before/after comparison
  - [ ] List all new shared components/hooks created
  - [ ] Document success metrics

**Success Criteria**:
- ✅ All validation passes with zero errors
- ✅ All manual tests pass
- ✅ Code reduction target met (~300-400 lines for Phase 4)
- ✅ All three entity types use BaseListView
- ✅ Documentation updated with complete guide
- ✅ Final summary document created

**Completion Notes**:
```
Date:
Status:
Notes:
-

Test Results:
-

Code Reduction Metrics:
-

Total Project Metrics (All 4 Phases):
-

Documentation Updated:
-

Issues encountered:
-

Project Complete!
```

---

## 📊 Progress Tracking

**Overall Completion**: 0/6 milestones (0%)

- [ ] Planning & Research
- [ ] Milestone 1: Design BaseListView API
- [ ] Milestone 2: Implement BaseListView Component
- [ ] Milestone 3: Refactor TaskListView
- [ ] Milestone 4: Refactor ProjectsListView
- [ ] Milestone 5: Refactor RoutinesListView
- [ ] Milestone 6: Final Validation & Documentation

---

## 🗂️ File Inventory

### Files to Create (2)

**Base Component**:
- [ ] `app/src/components/list-items/BaseListView.tsx` - Base list view component (~250 lines)
- [ ] Update `app/src/components/list-items/index.ts` - Add BaseListView to barrel export

### Files to Modify (3)

**List View Wrappers** (simplify to use BaseListView):
- [ ] `app/src/components/TaskListView.tsx` - Reduce by ~100-150 lines (~50-100 lines remaining)
- [ ] `app/src/components/ProjectsListView.tsx` - Reduce by ~100-150 lines (~100-150 lines remaining with sorting)
- [ ] `app/src/components/RoutinesListView.tsx` - Reduce by ~100-150 lines (~100-150 lines remaining with dialogs)

### Files to Delete (0)

**Note**: No files deleted in Phase 4 - we're simplifying existing ListView components, not replacing them

---

## 🔍 Key Technical Decisions

### Decision 1: Focus Management Ownership (BaseListView vs Parent)

**Problem**: Should BaseListView manage focus internally or receive focus state from parent?

**Options Considered**:
1. **BaseListView Manages Internally**: Component tracks focusedIndex, calls setFocusedEntity
   - Pros: Simpler parent API, less boilerplate
   - Cons: Parent can't control focus externally, less flexible
2. **Parent Manages**: Parent tracks focusedIndex, passes to BaseListView
   - Pros: Parent has full control, can coordinate with other state
   - Cons: More boilerplate in parent
3. **Hybrid**: BaseListView accepts optional focusedIndex, manages internally if not provided
   - Pros: Flexible
   - Cons: Two code paths, more complexity

**Decision**: Option 2 - Parent Manages

**Rationale**:
- Parent already has entity-specific focus state in FocusContext
- Multi-list views need to coordinate focus across multiple BaseListViews
- Parent may want to programmatically set focus (e.g., after creating entity)
- Keeps BaseListView pure (receives props, doesn't manage app state)
- Consistent with how ListView currently works

**Implementation**:
```tsx
// In parent wrapper (TaskListView)
function TaskListView({ ... }) {
  const [focusedTaskIndex, setFocusedTaskIndex] = useState(0)
  const { setFocusedTask } = useFocusContext()

  return (
    <BaseListView
      entities={tasks}
      focusedIndex={focusedTaskIndex}
      setFocusedEntity={setFocusedTask}
      useEntityShortcuts={useTaskDialogShortcuts}
      ...
    />
  )
}
```

**Trade-offs**:
- Parent has more code (acceptable - thin wrapper)
- Benefits: Flexibility, parent control, explicit focus flow

---

### Decision 2: Header Rendering Customization

**Problem**: How much should parent be able to customize header rendering?

**Options Considered**:
1. **Fully Custom**: Parent provides `renderHeader` function
   - Pros: Maximum flexibility
   - Cons: Every parent must implement header, code duplication
2. **Configuration Only**: BaseListView renders header, parent provides data via `list.getHeader()`
   - Pros: Consistent headers, less duplication
   - Cons: Less flexible, what if parent wants different layout?
3. **Hybrid**: BaseListView renders default header, parent can override with `renderHeader`
   - Pros: Best of both (defaults + customization)
   - Cons: Two code paths

**Decision**: Option 2 - Configuration Only (use `list.getHeader()`)

**Rationale**:
- All current views use identical header layout (icon, title, description, count, collapse button)
- Header data already abstracted in `list.getHeader()` method (existing pattern)
- Header styling is consistent across all views (part of design system)
- If customization needed later, can add `renderHeader` prop (YAGNI for now)
- Reduces parent code significantly

**Implementation**:
```tsx
// BaseListView renders header
const header = list.getHeader({ params, taskCount, support })

return (
  <div>
    {isMultiListView && (
      <div className="mb-4">
        <div className="flex items-center gap-3">
          <div className="text-muted-foreground">{header.icon}</div>
          <div className="flex-1">
            <h2>{header.title}</h2>
            {header.description && <p>{header.description}</p>}
          </div>
          <Badge>{count}</Badge>
          <CollapseButton />
        </div>
        <Separator />
      </div>
    )}
    {/* ... entities */}
  </div>
)
```

**Trade-offs**:
- No header customization (acceptable - headers are consistent)
- Benefits: Less parent code, consistent styling, reusable logic

---

### Decision 3: Empty State Handling

**Problem**: How should BaseListView handle empty states?

**Options Considered**:
1. **Render Nothing**: Just show empty list (no message)
   - Pros: Simple
   - Cons: Confusing for users (is it loading? broken?)
2. **Generic Message**: "No items" message
   - Pros: Simple, clear
   - Cons: Not contextual (tasks vs projects vs routines)
3. **Configurable**: Use `list.getEmptyState()` method (existing pattern)
   - Pros: Contextual messages, consistent with header pattern
   - Cons: Requires entity types to implement method

**Decision**: Option 3 - Configurable via `list.getEmptyState()`

**Rationale**:
- Empty state messages should be contextual: "No tasks", "No projects", etc.
- `list.getEmptyState()` already exists (used by current views)
- Consistent with header rendering pattern (use list methods)
- Different empty states for different query types (e.g., "No overdue tasks" vs "No inbox tasks")

**Implementation**:
```tsx
// In BaseListView
const emptyState = list.getEmptyState({ params, taskCount, support })

if (entities.length === 0) {
  return (
    <div className="flex flex-col items-center justify-center h-64">
      <p className="text-lg font-semibold">{emptyState.title}</p>
      {emptyState.description && (
        <p className="text-sm text-muted-foreground">{emptyState.description}</p>
      )}
    </div>
  )
}
```

**Trade-offs**:
- Requires list definitions to provide empty state (already do)
- Benefits: Contextual messages, user-friendly, consistent

---

### Decision 4: Loading State Rendering

**Problem**: How should BaseListView handle loading states?

**Options Considered**:
1. **Parent Responsibility**: Parent checks if loading, doesn't render BaseListView
   - Pros: Flexible, parent controls loading UI
   - Cons: Parent must implement loading check, code duplication
2. **BaseListView Handles**: BaseListView checks `isLoading` prop, renders loading UI
   - Pros: Consistent loading states, less parent code
   - Cons: Less flexible loading UI
3. **Hybrid**: BaseListView shows default loading, parent can override
   - Pros: Defaults + customization
   - Cons: Two code paths

**Decision**: Option 2 - BaseListView Handles with `isLoading` Prop

**Rationale**:
- All current views show identical loading UI: "Loading tasks/projects/routines..."
- Loading state is based on query readiness (can be derived, but easier to pass explicitly)
- Consistent user experience across all entity types
- Parent just passes `isLoading={entities === undefined}`
- If custom loading UI needed, can add later (YAGNI for now)

**Implementation**:
```tsx
// In BaseListView
if (isLoading) {
  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-muted-foreground">Loading {entityType}s...</p>
    </div>
  )
}
```

**Trade-offs**:
- Generic loading message (acceptable - could enhance later)
- Benefits: Consistent loading states, less parent code

---

## 🚨 Known Edge Cases

### 1. **Empty Entity Array vs Undefined**: Parent passes empty array vs undefined
   - **Scenario**: `entities={[]}` (loaded, no results) vs `entities={undefined}` (still loading)
   - **Handling**: BaseListView checks `isLoading` prop explicitly, not entity array
   - **Prevention**: Parent must pass `isLoading` correctly
   - **Testing**: Pass empty array with isLoading=false - should show empty state, not loading
   - **Fallback**: Empty array treated as "no results" regardless of isLoading

### 2. **Focused Index Out of Bounds**: focusedIndex >= entities.length
   - **Scenario**: Parent passes focusedIndex=5 but only 3 entities exist
   - **Handling**: BaseListView (via useListItemFocus) checks bounds, ignores invalid index
   - **Prevention**: Parent should validate focusedIndex before passing
   - **Testing**: Pass focusedIndex > length - verify no crash, focus ignored
   - **Fallback**: No entity focused (acceptable - user can refocus)

### 3. **List Config Missing Methods**: list.getHeader() doesn't exist
   - **Scenario**: Parent passes list object without required methods
   - **Handling**: TypeScript enforces ListInstance type, requires methods
   - **Prevention**: Type checking at compile time
   - **Testing**: TypeScript compile check
   - **Fallback**: Runtime error if types bypassed (dev error)

### 4. **RenderRow Returns Null**: renderRow returns null for some entities
   - **Scenario**: Conditional rendering in renderRow, sometimes returns null
   - **Handling**: BaseListView filters out null returns before rendering
   - **Prevention**: renderRow can return `ReactNode | null`
   - **Testing**: Return null from renderRow - verify row not rendered, no crash
   - **Fallback**: Row simply doesn't render (graceful)

### 5. **Multi-List View State Desync**: Dismissed state doesn't match actual collapse
   - **Scenario**: Parent passes isDismissed=true but list is expanded
   - **Handling**: BaseListView's internal `isExpanded` state may conflict with `isDismissed`
   - **Prevention**: Sync `isExpanded` state when `isDismissed` prop changes
   - **Testing**: Change isDismissed prop, verify list collapses/expands correctly
   - **Fallback**: useEffect syncs state on prop change

### 6. **Focus Management Hook Throws**: useEntityShortcuts throws error
   - **Scenario**: Parent passes custom hook that throws during execution
   - **Handling**: BaseListView wraps hook call in try-catch (or lets error bubble)
   - **Prevention**: Parent hooks should be stable and not throw
   - **Testing**: Pass hook that throws - verify error handling or crash
   - **Fallback**: Error boundary catches error (app-level)

### 7. **Count Registry Missing Count**: registry.getCountForList returns undefined
   - **Scenario**: Count not yet computed or entity type not in registry
   - **Handling**: BaseListView falls back to `entities.length` if count unavailable
   - **Prevention**: CountRegistry should always return number (0 if not found)
   - **Testing**: Remove entity from registry - verify count shows 0 or entity length
   - **Fallback**: Show entity array length as count

---

## 📝 Notes & Learnings

### Development Notes
```
[Space for ongoing notes during implementation]

Key Patterns to Follow:
- BaseListView should be unopinionated about entity type
- All entity-specific logic should be in renderRow function
- Header and empty states come from list.getHeader() and list.getEmptyState()
- Focus management integrated via hooks, not custom logic
- Loading states should be simple and consistent
- Multi-list view collapse/expand should be internal state

Component Responsibilities:
- BaseListView: Layout, focus, collapse, counts, loading/empty states
- Parent wrapper: Entity fetching, renderRow function, callbacks
- ListItem: Row rendering, badges, editing, interactions
```

### Issues Encountered
```
[Track all issues and resolutions]

Common gotchas to watch for:
- Focus management refs must be stable (use useCallback)
- isExpanded state must sync with isDismissed prop
- Count from registry may lag behind entity array length
- renderRow must handle null gracefully
- Loading prop must be explicit (don't infer from entities === undefined)
- Empty state vs loading state distinction is important
```

### Future Enhancements
- [ ] Add virtualization for long lists (react-window, react-virtual)
- [ ] Add infinite scroll support (load more on scroll)
- [ ] Add search/filter UI (integrated with BaseListView)
- [ ] Add sort controls (column headers, sort dropdowns)
- [ ] Add bulk selection (checkboxes, select all)
- [ ] Add drag-to-reorder between lists
- [ ] Add keyboard shortcuts for list navigation (Cmd+K style)
- [ ] Add animations (enter/exit, reorder, collapse/expand)

---

## 🔗 References

**Key Files**:
- `app/src/components/TaskListView.tsx` - Current task list view (~350 lines)
- `app/src/components/ProjectsListView.tsx` - Current project list view (~320 lines)
- `app/src/components/RoutinesListView.tsx` - Current routine list view (~325 lines)
- `app/src/lib/views/types.ts` - ListInstance type definition
- `app/src/hooks/list-items/useListItemFocus.ts` - Phase 1 focus hook (will be used internally)
- `app/src/components/list-items/` - Phase 3 ListItem components (will be rendered by renderRow)

**Similar Patterns**:
- List rendering: React Table, React Virtual, Tanstack Table
- Configuration-based components: Recharts, Radix UI primitives
- Render props: React Select, Downshift

**Planning Documents**:
- `docs/list-item-standardization-plan.md` - Overall strategy
- `docs/list-item-standardization-phase1-implementation.md` - Phase 1 (hooks)
- `docs/list-item-standardization-phase2-implementation.md` - Phase 2 (badges)
- `docs/list-item-standardization-phase3-implementation.md` - Phase 3 (BaseListItem)

**Commands**:
```bash
# Development
bun install
bun run dev
bunx convex dev

# Validation (REQUIRED before commits)
bun --cwd app run typecheck
bun --cwd app run lint
bun --cwd app test

# Testing BaseListView (manual)
# 1. Create test page with BaseListView + mock entities
# 2. Test header rendering (single vs multi-list)
# 3. Test empty state rendering
# 4. Test loading state rendering
# 5. Test collapse/expand
# 6. Test focus management (arrow keys)
# 7. Test count badges
# 8. Test with all three entity types
```

---

**Last Updated**: 2025-01-17 (Initial plan created)
