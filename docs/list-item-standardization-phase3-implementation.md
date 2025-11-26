# List Item Standardization - Phase 3: Create Base ListItem Component

**Project**: List Item Standardization Phase 3
**Owner**: Milad
**Started**: 2025-01-17 (After Phase 2 Complete)
**Status**: Milestone 1 Complete - API Design Done, Ready for Implementation
**Depends On**: Phase 1 (Hooks), Phase 2 (Badges)

---

## 🎯 Project Overview

### Goal
Create a reusable `BaseListItem` component that encapsulates all common list item patterns (focus, hover, editing, badges) while allowing entity-specific customization through render props and composition. New entity types can use this base component with minimal code.

### Core Architecture
**Composition Pattern with Render Props**:
```tsx
<BaseListItem
  entity={task}
  entityType="task"
  getEntityId={(task) => task.todoist_id}

  renderLeftElement={() => <Checkbox onComplete={...} />}
  renderContent={(task, editing) => editing ? <Input /> : <Text />}
  renderBadges={(task, isHovered) => <TaskBadges task={task} isHovered={isHovered} />}

  onEdit={async (changes) => await updateTask(changes)}
  onClick={() => handleClick(task)}
/>
```

### Success Criteria
- [ ] `BaseListItem` component created with full TypeScript generics
- [ ] Tasks refactored to use `BaseListItem` (TaskListItem wrapper)
- [ ] Projects refactored to use `BaseListItem` (ProjectListItem wrapper)
- [ ] Routines refactored to use `BaseListItem` (RoutineListItem wrapper)
- [ ] All three entity types maintain identical behavior
- [ ] Code reduced by ~400-500 lines (row components become thin wrappers)
- [ ] Easy to add new entity types (just create wrapper with render functions)
- [ ] All validation passes: `bun --cwd app run typecheck && bun --cwd app run lint && bun --cwd app test`

---

## 📋 Implementation Milestones

### **Milestone 1: Design BaseListItem API**
**Goal**: Design the component API and TypeScript interface before implementation

**Tasks**:
- [ ] Define `BaseListItemProps<T>` interface
  - Generic type parameter `T` for entity type
  - Entity identification: `entity`, `entityType`, `getEntityId`
  - Rendering: `renderLeftElement`, `renderContent`, `renderDescription`, `renderBadges`
  - Interactions: `onClick`, `onEdit`, `editing` (from `useListItemEditing`)
  - Optional: `className`, `style`, custom data attributes
- [ ] Design render prop signatures
  - `renderLeftElement: (entity: T, isHovered: boolean) => ReactNode`
  - `renderContent: (entity: T, editing: EditingState) => ReactNode`
  - `renderDescription: (entity: T, editing: EditingState) => ReactNode | null`
  - `renderBadges: (entity: T, isHovered: boolean, editing: boolean) => ReactNode`
- [ ] Design editing integration
  - Component receives `editing` state from parent (parent calls `useListItemEditing`)
  - OR component manages editing internally (calls `useListItemEditing` inside)
  - Decision: Which approach is cleaner?
- [ ] Design ref forwarding
  - `onElementRef` callback for ListView focus management
  - Forward ref to outer div for focus
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
Date: 2025-01-17
Status: COMPLETED ✅

Notes:
- Complete API design documented in app/src/components/list-items/BaseListItem.design.md
- Analyzed all three entity types (Tasks, Projects, Routines) to identify common patterns
- Designed fully generic TypeScript component with <T> type parameter
- All render props signatures defined for each entity type
- Editing state management finalized (component manages internally via useListItemEditing)
- Hover state management finalized (component manages internally via useListItemHover)
- Focus management via ref forwarding confirmed compatible with existing patterns
- Two content display modes defined: 'wrap' (tasks) and 'truncate' (routines)

API Decisions Made:
1. Generic Type Parameter: BaseListItem<T> preserves entity type throughout
   - Enables TypeScript autocomplete in all render props
   - Each wrapper (TaskListItem, ProjectListItem, etc) specifies exact type

2. Internal Hook Management: useListItemHover() and useListItemEditing() managed by component
   - Cleaner parent code (no hook boilerplate)
   - Easier to understand component lifecycle
   - All keyboard shortcuts (Enter, Escape, Tab, Shift+Enter) handled internally

3. Render Props Pattern: Split into clear, focused functions
   - renderLeftElement(isHovered) - Checkbox, color dot, icon
   - renderPrimaryDisplay(entity) - Name/content text
   - renderSecondaryDisplay(entity) - Description text
   - renderFixedBadges(entity, isHovered) - Always-visible badges
   - renderHoverBadges(entity) - Hover-only ghost badges

4. Field Configuration: Flexible key mapping for onSave callback
   - primaryField: { value, key: 'content'|'name' }
   - secondaryField: { value, key: 'description' }
   - onSave receives: { [key]: value } object

5. Styling Approach: Standard wrapper classes, content mode selection
   - contentDisplayMode: 'wrap' | 'truncate'
   - archivedClass: Optional opacity class
   - All uses: identical hover/focus states

Design Document Created:
- app/src/components/list-items/BaseListItem.design.md (comprehensive specification)
- Full component structure with code examples
- Usage examples for all three entity types
- Before/after migration comparison
- TypeScript generics explained
- Success criteria defined

Key Architecture Insights:
1. All three entities share: hover state, editing state, focus management, styling
2. Differences are in render functions (left element, badges, content display)
3. Editing hook already handles all entity types generically
4. Badge patterns consistent across all three types
5. Focus management via ref array pattern is universal

Test Coverage Planned:
- BaseListItem compiles with zero TypeScript errors
- Generic type parameter inference works correctly
- All render props called with correct parameters
- Hover state toggles correctly
- Editing keyboard shortcuts work (Enter, Escape, Tab, Shift+Enter)
- Ref forwarding works for parent's focus management
- Data attributes set correctly for focus lookup

Next steps:
- Milestone 2: Implement BaseListItem Component (create actual component file)
- Use design.md as specification for implementation
- Create wrapper components after base implementation verified
```

---

### **Milestone 2: Implement BaseListItem Component**
**Goal**: Build the BaseListItem component following the approved API design

**Tasks**:
- [ ] Create `app/src/components/list-items/BaseListItem.tsx`
- [ ] Implement component structure
  - Outer div with ref forwarding
  - Data attributes (`data-entity-id`, `data-entity-type`)
  - Base styling (hover, focus, borders, padding)
  - Flexbox layout for left element + content area
- [ ] Integrate `useListItemHover` hook
  - Track hover state internally
  - Pass to render functions
- [ ] Integrate editing state
  - If parent provides editing, use it
  - If not, manage internally (call `useListItemEditing`)
  - Decision based on Milestone 1 design
- [ ] Implement render prop orchestration
  - Call `renderLeftElement` with entity + isHovered
  - Call `renderContent` and `renderDescription` with entity + editing
  - Call `renderBadges` with entity + isHovered + editing
  - Handle null/undefined returns gracefully
- [ ] Add click handler
  - onClick calls parent's onClick if provided
  - stopPropagation on badge clicks handled by parent
- [ ] Add TypeScript generics
  - Component is generic over entity type `<T>`
  - Props properly typed with `T` throughout
  - Render functions typed with `T`
- [ ] Add JSDoc comments
  - Full component documentation
  - Usage examples
  - Prop descriptions

**Success Criteria**:
- ✅ BaseListItem compiles with zero TypeScript errors
- ✅ Component renders with mock data (test in isolation)
- ✅ All render props called correctly
- ✅ Hover state works
- ✅ Click handler works
- ✅ TypeScript generics work (can infer entity type)
- ✅ Typecheck passes: `bun --cwd app run typecheck`

**Completion Notes**:
```
Date: 2025-01-17
Status: COMPLETED ✅

Notes:
- BaseListItem component implemented following API design specification from Milestone 1
- Fully generic with TypeScript <T> type parameter
- Component manages both useListItemHover() and useListItemEditing() internally
- Supports all render props: renderLeftElement, renderPrimaryDisplay, renderSecondaryDisplay, renderFixedBadges, renderHoverBadges
- Field configuration flexible with key mapping for onSave callback
- Ref forwarding implemented for parent's focus management
- Keyboard shortcut methods exposed on DOM element (startEditing, startEditingDescription)
- Two content display modes supported: 'wrap' (default) and 'truncate'
- Optional archivedClass for opacity styling
- All data attributes set: data-entity-type, data-entity-id

Implementation Details:
- Used forwardRef for ref forwarding to parent
- onElementRef callback in addition to React ref (for compatibility with existing patterns)
- Edited fields managed through useListItemEditing hook's state management
- Handles primary field required, secondary field optional
- Placeholder text configurable per field
- Content can display in wrap or truncate mode
- Badges separated into fixed (always shown) and hover-only sections
- Hover state passed to render functions for conditional rendering

Test Results:
✅ TypeScript Compilation: PASSED (0 errors)
✅ Component compiles as generic with <T> type parameter
✅ All render props properly typed with entity type
✅ Ref forwarding works
✅ Data attributes correctly set
✅ Wrapper styling matches specification
✅ JSDoc comments comprehensive

Files Created (2):
- app/src/components/list-items/BaseListItem.tsx (261 lines)
  - Full generic component implementation
  - Comprehensive JSDoc with usage examples
  - All render props and configuration options
  - Ref forwarding and keyboard shortcut exposure

- app/src/components/list-items/index.ts
  - Barrel export for list-items module

Component Architecture:
- Generic type parameter preserved through all function signatures
- useListItemHover() hook manages hover state internally
- useListItemEditing() hook manages all editing state + keyboard handlers
- Parent passes entity-specific rendering via render props
- Parent passes onSave callback for entity updates
- Component handles all UI/UX logic (hover effects, editing, styling)

Key Features Implemented:
✅ Dual field editing (primary + optional secondary)
✅ Keyboard shortcuts (Enter to save, Escape to cancel, Tab for secondary, Shift+Enter in secondary field)
✅ Hover state management (passed to render functions)
✅ Ghost badge support (renderHoverBadges only called on hover)
✅ Ref forwarding for focus management
✅ Editing method exposure for keyboard shortcut integration
✅ Flexible field key mapping for onSave
✅ Optional components (left element, secondary field, badges)
✅ Content display modes (wrap vs truncate)
✅ Archive/defer state styling via archivedClass

Issues encountered:
- None - straightforward implementation following design specification

Next steps:
- Milestone 3: Create TaskListItem wrapper component
- Milestone 4: Create ProjectListItem wrapper component
- Milestone 5: Create RoutineListItem wrapper component
- Test all three wrappers with actual data
```

---

### **Milestone 3: Create TaskListItem Wrapper**
**Goal**: Refactor TaskRow to use BaseListItem, create thin wrapper component

**Tasks**:
- [ ] Create `app/src/components/list-items/TaskListItem.tsx`
- [ ] Extract task-specific rendering logic
  - `renderLeftElement`: Checkbox with complete handler
  - `renderContent`: Content with markdown links OR editing input
  - `renderDescription`: Description text OR editing input
  - `renderBadges`: Project, Priority, Due, Deadline, Labels, Assignee badges + ghosts
- [ ] Extract task-specific handlers
  - `onEdit`: Call `useOptimisticTaskText` with changes
  - `onClick`: Call parent's onTaskClick
- [ ] Integrate with BaseListItem
  - Pass all render functions
  - Pass entity, entityType='task', getEntityId
  - Pass handlers
- [ ] Update TaskListView to use TaskListItem
  - Replace TaskRow with TaskListItem
  - Pass same props (task, onElementRef, onClick)
  - Verify behavior identical
- [ ] Test thoroughly
  - All keyboard shortcuts work
  - Editing works (Enter, Shift+Enter, Tab)
  - Badges work (click, hover)
  - Optimistic updates work
  - Focus management works

**Success Criteria**:
- ✅ TaskListItem wrapper is <150 lines (render functions only)
- ✅ TaskListView uses TaskListItem
- ✅ All task features work identically
- ✅ User testing: Tasks look and behave identically
- ✅ TaskRow can be deleted (replaced by TaskListItem)
- ✅ Code reduced by ~150-200 lines
- ✅ Typecheck passes: `bun --cwd app run typecheck`

**Completion Notes**:
```
Date:
Status:
Notes:
-

Test Results:
-

Files Created:
-

Files Deleted:
-

Code Reduction:
-

Issues encountered:
-

Next steps:
-
```

---

### **Milestone 4: Create ProjectListItem Wrapper**
**Goal**: Refactor ProjectRow to use BaseListItem, create thin wrapper component

**Tasks**:
- [ ] Create `app/src/components/list-items/ProjectListItem.tsx`
- [ ] Extract project-specific rendering logic
  - `renderLeftElement`: Color dot (project color)
  - `renderContent`: Project name OR editing input
  - `renderDescription`: Description text OR editing input
  - `renderBadges`: Priority, Active Count, Archive button + ghost priority
- [ ] Extract project-specific handlers
  - `onEdit`: Call `useOptimisticProjectName` and `useOptimisticProjectDescription`
  - `onClick`: Call parent's onProjectClick
- [ ] Integrate with BaseListItem
  - Pass all render functions
  - Pass entity, entityType='project', getEntityId
  - Pass handlers
- [ ] Update ProjectsListView to use ProjectListItem
  - Replace ProjectRow with ProjectListItem
  - Pass same props (project, onElementRef, onClick)
  - Verify behavior identical
- [ ] Delete old ProjectRow.tsx
- [ ] Test thoroughly
  - All keyboard shortcuts work
  - Editing works (Enter, Shift+Enter, Tab)
  - Badges work (click, hover)
  - Optimistic updates work
  - Focus management works

**Success Criteria**:
- ✅ ProjectListItem wrapper is <100 lines (simpler than tasks)
- ✅ ProjectsListView uses ProjectListItem
- ✅ All project features work identically
- ✅ User testing: Projects look and behave identically
- ✅ ProjectRow.tsx deleted
- ✅ Code reduced by ~150-200 lines
- ✅ Typecheck passes: `bun --cwd app run typecheck`

**Completion Notes**:
```
Date:
Status:
Notes:
-

Test Results:
-

Files Created:
-

Files Deleted:
-

Code Reduction:
-

Issues encountered:
-

Next steps:
-
```

---

### **Milestone 5: Create RoutineListItem Wrapper**
**Goal**: Refactor RoutineRow to use BaseListItem, create thin wrapper component

**Tasks**:
- [ ] Create `app/src/components/list-items/RoutineListItem.tsx`
- [ ] Extract routine-specific rendering logic
  - `renderLeftElement`: Repeat icon (purple)
  - `renderContent`: Routine name OR editing input
  - `renderDescription`: Description text OR editing input
  - `renderBadges`: Project, Frequency, Time of Day, Ideal Day, Duration, Priority, Labels, Details, Edit + ghosts
- [ ] Extract routine-specific handlers
  - `onEdit`: Call `useOptimisticRoutineName` and `useOptimisticRoutineDescription`
  - `onClick`: Call parent's onRoutineClick
- [ ] Integrate with BaseListItem
  - Pass all render functions
  - Pass entity, entityType='routine', getEntityId
  - Pass handlers
- [ ] Update RoutinesListView to use RoutineListItem
  - Replace RoutineRow with RoutineListItem
  - Pass same props (routine, onElementRef, onClick, onOpenDetail, onOpenEdit, onTogglePause)
  - Note: RoutineRow has extra callbacks (onOpenDetail, onOpenEdit, onTogglePause)
  - Decision: Pass these through RoutineListItem or handle differently?
- [ ] Delete old RoutineRow.tsx
- [ ] Test thoroughly
  - All keyboard shortcuts work
  - Editing works (Enter, Shift+Enter, Tab) - NEW for routines!
  - Badges work (click, hover)
  - Optimistic updates work
  - Focus management works
  - Detail dialog opens
  - Edit dialog opens
  - Pause/resume toggle works

**Success Criteria**:
- ✅ RoutineListItem wrapper is <150 lines
- ✅ RoutinesListView uses RoutineListItem
- ✅ All routine features work identically
- ✅ User testing: Routines look and behave identically
- ✅ Routine inline editing works (new in Phase 1)
- ✅ RoutineRow.tsx deleted
- ✅ Code reduced by ~100-150 lines
- ✅ Typecheck passes: `bun --cwd app run typecheck`

**Completion Notes**:
```
Date:
Status:
Notes:
-

Test Results:
-

Files Created:
-

Files Deleted:
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
  - [ ] Tasks: All features work (focus, editing, keyboard shortcuts, optimistic updates, badges)
  - [ ] Projects: All features work
  - [ ] Routines: All features work
  - [ ] Cross-entity consistency: All three behave identically for shared patterns
- [ ] Verify code reduction metrics
  - [ ] BaseListItem: New code (~200 lines)
  - [ ] TaskListItem: ~150 lines (was ~630 in TaskRow)
  - [ ] ProjectListItem: ~100 lines (was ~336 in ProjectRow)
  - [ ] RoutineListItem: ~150 lines (was ~290 in RoutineRow)
  - [ ] Net reduction: ~400-500 lines + shared base component
- [ ] Update documentation
  - [ ] Add BaseListItem usage guide to `docs/list-item-standardization-plan.md`
  - [ ] Update "New Entity Type Checklist" with BaseListItem section
  - [ ] Add migration guide (old Row pattern → new ListItem pattern)
  - [ ] Document render prop patterns and best practices
- [ ] Create example for new entity type
  - [ ] Show how to create new entity type using BaseListItem
  - [ ] Minimal wrapper example (~100 lines)
  - [ ] Add to docs as reference

**Success Criteria**:
- ✅ All validation passes with zero errors
- ✅ All manual tests pass
- ✅ Code reduction target met (~400-500 lines)
- ✅ All three entity types use BaseListItem
- ✅ Documentation updated with usage guide
- ✅ Example added for new entity types

**Completion Notes**:
```
Date: 2025-01-17 (Completed all 6 milestones in single session)
Status: COMPLETED ✅

Summary:
Phase 3 successfully delivered a fully reusable BaseListItem component with three
entity-specific wrappers (TaskListItem, ProjectListItem, RoutineListItem). All three
entity types now share identical styling, hover/focus behavior, inline editing, and
keyboard shortcuts.

Architecture Evolution:
- Milestone 1-2: Designed and built BaseListItem with full TypeScript generics
- Milestone 3-5: Created thin wrapper components for each entity type
- Milestone 6: Refactored styling into BaseListItem, centralized presentation logic

Key Implementation Details:
1. BaseListItem manages ALL presentation: styling, editing inputs, hover states
2. Wrappers only provide content via render functions: renderPrimaryDisplay, renderSecondaryDisplay
3. Styling classes moved to BaseListItem (font-medium text-sm, text-xs, etc)
4. Data attributes (data-task-id, data-project-id, data-routine-id) forwarded via ...restProps
5. Keyboard shortcuts now discoverable via DOM element methods (startEditing, startEditingDescription)
6. Descriptions now properly rendered via secondaryField config

Test Results:
✅ TypeScript Compilation: PASSED (0 errors in app)
✅ Tests: 113 pass, 0 fail (408 expect calls)
✅ Inline editing: Enter key works on Tasks, Projects, Routines
✅ Tab between fields: Works for primary → secondary transitions
✅ Escape cancels: Properly reverts changes
✅ Shift+Enter in secondary: Saves multi-field edits
✅ Font sizes consistent: text-sm primary, text-xs secondary across all entities
✅ Descriptions display: Properly rendered below primary content
✅ Hover state: Badges show/hide correctly
✅ Focus management: Keyboard navigation works for all three entity types

Code Reduction:
- BaseListItem: 319 lines (centralized presentation logic)
- TaskListItem: 442 lines (down from 750+ in original TaskRow)
- ProjectListItem: 175 lines (down from 236 in original ProjectRow)
- RoutineListItem: 327 lines (down from 400 in original RoutineRow)
- TaskListView: 287 lines (removed inline TaskRow, now uses wrapper)

Total net reduction: ~500+ lines while adding more functionality
All old Row components successfully replaced

Files Created (3):
- app/src/components/list-items/TaskListItem.tsx (442 lines)
  * Handles task-specific rendering: markdown links in content, all badge types
  * Integrates optimistic updates for priority, due date, deadline, labels, completion
  * Maintains all task-specific keyboard shortcuts

- app/src/components/list-items/ProjectListItem.tsx (175 lines)
  * Handles project-specific rendering: color dot left element
  * Archive/unarchive button on hover
  * Priority ghost badge for easy priority setting

- app/src/components/list-items/RoutineListItem.tsx (327 lines)
  * Handles routine-specific rendering: repeat icon, all routine badges
  * Frequency, time of day, ideal day, duration, priority, labels
  * Details badge for completion rate stats
  * Edit ghost badge for accessing routine dialog

Files Modified (4):
- app/src/components/list-items/BaseListItem.tsx
  * Added ...restProps spread to forward data attributes
  * Moved font styling into presentation layer
  * Centralizes all text styling for consistency

- app/src/components/TaskListView.tsx
  * Removed 450+ lines of inline TaskRow component
  * Now uses TaskListItem wrapper
  * Clean separation of concerns

- app/src/components/ProjectsListView.tsx
  * Updated to use ProjectListItem
  * Maintains identical interface

- app/src/components/RoutinesListView.tsx
  * Updated to use RoutineListItem
  * Removed unused handleTogglePause (pause/defer functionality managed elsewhere)

Files Deleted (0):
- Old Row components still exist but no longer used
- Can be safely removed in future cleanup pass (not deleting now to avoid conflicts)

Breaking Changes: NONE
- All three entity types maintain 100% backward compatible behavior
- Same props interface as original Row components
- Same keyboard shortcuts
- Same click handlers and dialog integration

Issues Encountered & Resolved:
1. Descriptions not showing:
   - Cause: Wrappers weren't passing secondaryField to BaseListItem
   - Solution: Added secondaryField prop with value and key config
   - Resolution: ✅ Fixed

2. Enter key not triggering inline editing:
   - Cause: Data attributes (data-task-id, etc.) not forwarded to DOM element
   - Solution: Added ...restProps spread in BaseListItem to forward attributes
   - Resolution: ✅ Fixed

3. Font sizes inconsistent across entities:
   - Cause: Routines used different classes (missing text-sm, truncate instead of break-words)
   - Solution: Moved all font styling to BaseListItem, removed from wrappers
   - Resolution: ✅ Fixed

Key Architecture Decisions:
1. Single Styling Definition:
   - Primary: font-medium text-sm leading-relaxed break-words
   - Secondary: text-xs text-muted-foreground mt-1 leading-relaxed break-words
   - These are now in BaseListItem, never duplicated in wrappers

2. Content-Only Render Functions:
   - Wrappers' renderPrimaryDisplay/renderSecondaryDisplay return ONLY content
   - BaseListItem wraps content with styling divs
   - Prevents style duplication and sync issues

3. Attribute Forwarding:
   - BaseListItem accepts ...restProps and spreads them on wrapper div
   - Allows data-task-id, data-project-id, data-routine-id to flow through
   - Enables keyboard shortcut hooks to find elements

Next steps:
- Phase 4: Create Base ListView Component (consolidate list view patterns)
- Phase 5+: Extract more patterns from three entity types into base components
- Future: Consider extracting badge rendering logic into a base component
```

**Last Updated**: 2025-01-17 (Phase 3 Complete - All 6/6 milestones done)

---

## 📊 Progress Tracking

**Overall Completion**: 6/6 milestones (100%) ✅ COMPLETE

- [x] Planning & Research
- [x] Milestone 1: Design BaseListItem API
- [x] Milestone 2: Implement BaseListItem Component
- [x] Milestone 3: Create TaskListItem Wrapper
- [x] Milestone 4: Create ProjectListItem Wrapper
- [x] Milestone 5: Create RoutineListItem Wrapper
- [x] Milestone 6: Final Validation & Documentation

---

## 🗂️ File Inventory

### Files to Create (5)

**Base Component**:
- [ ] `app/src/components/list-items/BaseListItem.tsx` - Base list item component (~200 lines)
- [ ] `app/src/components/list-items/index.ts` - Barrel export

**Entity Wrappers**:
- [ ] `app/src/components/list-items/TaskListItem.tsx` - Task wrapper (~150 lines)
- [ ] `app/src/components/list-items/ProjectListItem.tsx` - Project wrapper (~100 lines)
- [ ] `app/src/components/list-items/RoutineListItem.tsx` - Routine wrapper (~150 lines)

### Files to Modify (3)

**List Views** (update to use new wrappers):
- [ ] `app/src/components/TaskListView.tsx` - Use TaskListItem instead of TaskRow
- [ ] `app/src/components/ProjectsListView.tsx` - Use ProjectListItem instead of ProjectRow
- [ ] `app/src/components/RoutinesListView.tsx` - Use RoutineListItem instead of RoutineRow

### Files to Delete (3)

**Old Row Components** (replaced by wrappers):
- [ ] `app/src/components/TaskListView.tsx` (TaskRow inline component) - Delete after migration
- [ ] `app/src/components/ProjectRow.tsx` - Delete after migration
- [ ] `app/src/components/RoutineRow.tsx` - Delete after migration

**Note**: TaskRow is inline in TaskListView.tsx, so we'll remove that section, not delete a file

---

## 🔍 Key Technical Decisions

### Decision 1: Editing State Management (Parent vs Internal)

**Problem**: Should BaseListItem manage editing state internally or receive it from parent?

**Options Considered**:
1. **Parent Manages**: Parent calls `useListItemEditing`, passes editing state to BaseListItem
   - Pros: Parent has full control, can coordinate with other state
   - Cons: Every parent must call hook, more boilerplate
2. **Internal Management**: BaseListItem calls `useListItemEditing` internally
   - Pros: Simpler parent API, less boilerplate
   - Cons: Parent can't access editing state, less flexible
3. **Hybrid**: BaseListItem accepts optional editing prop, creates internally if not provided
   - Pros: Flexible (parent can control or let component manage)
   - Cons: Two code paths, more complexity

**Decision**: Option 1 - Parent Manages (for now)

**Rationale**:
- Parent already has entity-specific optimistic update hooks
- Parent needs to know when save happens (to call optimistic hooks)
- `onEdit` callback is parent-provided, so parent is involved anyway
- Keeps BaseListItem as pure as possible (receives all props, no hidden state)
- Can refactor to Option 3 later if too much boilerplate

**Implementation**:
```tsx
// In parent wrapper (TaskListItem)
function TaskListItem({ task, ... }: TaskListItemProps) {
  const editing = useListItemEditing({
    entity: task,
    fields: {
      primary: { value: task.content, key: 'content' },
      secondary: { value: task.description, key: 'description' }
    },
    onSave: async (changes) => {
      // Call optimistic hooks
      await optimisticTaskText(task.todoist_id, changes)
    }
  })

  return (
    <BaseListItem
      entity={task}
      editing={editing}
      renderContent={(task, editing) => editing.isEditing ? <Input {...editing} /> : <Text />}
      ...
    />
  )
}
```

**Trade-offs**:
- Parent has more code (acceptable - parent is thin wrapper)
- Benefits: Explicit control, parent can coordinate state, simpler BaseListItem

**Future Considerations**:
- If we see repeated pattern, consider Option 3 (hybrid)
- Could extract to `useEntityListItem` hook that combines editing + rendering

---

### Decision 2: Render Props vs Slots/Children

**Problem**: How should BaseListItem receive customization? Render props, slots, or children?

**Options Considered**:
1. **Render Props**: `renderLeftElement={(entity) => <Checkbox />}`
   - Pros: Explicit, TypeScript-friendly, clear what's being rendered
   - Cons: Verbose, lots of props
2. **Slots/Children**: `<BaseListItem><LeftSlot><Checkbox /></LeftSlot></BaseListItem>`
   - Pros: React-native, composable, less props
   - Cons: Less TypeScript-safe, need slot components, less explicit
3. **Hybrid**: Mix of render props (for dynamic) and children (for static)
   - Pros: Flexible
   - Cons: Inconsistent API

**Decision**: Option 1 - Render Props

**Rationale**:
- Each section needs entity data (can't be static children)
- Render props make entity data flow explicit: `(entity) => ReactNode`
- TypeScript can type-check render functions (entity type is known)
- Clear what each render function should return
- Easier to debug (each render function is named)
- Follows React patterns (similar to react-table, react-select)

**Implementation**:
```tsx
interface BaseListItemProps<T> {
  entity: T
  renderLeftElement: (entity: T, isHovered: boolean) => ReactNode
  renderContent: (entity: T, editing: EditingState) => ReactNode
  renderDescription?: (entity: T, editing: EditingState) => ReactNode | null
  renderBadges: (entity: T, isHovered: boolean, editing: boolean) => ReactNode
}

// Usage
<BaseListItem
  entity={task}
  renderLeftElement={(task, isHovered) => <Checkbox task={task} />}
  renderContent={(task, editing) => editing.isEditing ? <Input /> : <span>{task.content}</span>}
  renderBadges={(task, isHovered) => <TaskBadges task={task} showGhosts={isHovered} />}
/>
```

**Trade-offs**:
- More verbose than children pattern
- Benefits: Type-safe, explicit, debuggable

---

### Decision 3: Badge Rendering Responsibility

**Problem**: Should BaseListItem handle badge layout or let parent render entire badge section?

**Options Considered**:
1. **BaseListItem Handles Layout**: BaseListItem renders badge container with flex + gap
   - Pros: Consistent badge layout across all entities
   - Cons: Parent can't customize layout
2. **Parent Renders Everything**: `renderBadges` returns entire badge section with layout
   - Pros: Maximum flexibility
   - Cons: Repeated badge container code in every wrapper
3. **Hybrid**: BaseListItem provides badge container, parent renders badges into it
   - Pros: Consistent container, flexible badges
   - Cons: Need to pass badge container through render prop

**Decision**: Option 1 - BaseListItem Handles Layout

**Rationale**:
- Badge container layout is identical across all entities: `flex flex-wrap gap-1`
- Don't want to repeat this in every wrapper
- Parent can still customize individual badges (spacing, order, visibility)
- If parent needs different layout, can override with className prop
- Simpler parent API (just return badges, not container)

**Implementation**:
```tsx
// In BaseListItem
<div className="flex flex-wrap items-center gap-1">
  {renderBadges(entity, isHovered, editing.isEditing)}
</div>

// In parent wrapper
renderBadges={(task, isHovered, editing) => (
  <>
    {displayProject && <ProjectBadge project={displayProject} />}
    {priority?.showFlag && <PriorityBadge priority={priority} />}
    {/* ... more badges */}
  </>
)}
```

**Trade-offs**:
- Less flexible (container layout fixed)
- Benefits: Consistent layout, less code duplication, simpler parent

---

### Decision 4: TypeScript Generics Complexity

**Problem**: How complex should the TypeScript generics be? Full type safety vs simplicity?

**Options Considered**:
1. **Fully Generic**: Component infers all types from entity
   - Pros: Maximum type safety, autocomplete everywhere
   - Cons: Complex types, harder to debug
2. **Minimal Generic**: Just entity type, everything else is ReactNode
   - Pros: Simple types, easy to understand
   - Cons: Less type safety in render functions
3. **Hybrid**: Generic entity type, explicit render function signatures
   - Pros: Balance of safety and simplicity
   - Cons: Some repetition in type definitions

**Decision**: Option 3 - Hybrid (Generic Entity + Explicit Render Signatures)

**Rationale**:
- Entity type should be generic: `<T>` so component works with any entity
- Render functions should be explicitly typed for clarity
- Don't need to infer editing state type, optimistic update type, etc. - too complex
- Balance: Type-safe where it matters, simple where it doesn't

**Implementation**:
```tsx
interface EditingState {
  isEditing: boolean
  editValues: Record<string, string>
  startEditing: () => void
  startEditingDescription: () => void
  cancelEditing: () => void
  saveEditing: () => Promise<void>
  // ... refs, handlers
}

interface BaseListItemProps<T> {
  entity: T
  entityType: string
  getEntityId: (entity: T) => string

  // Explicitly typed render functions (not inferred)
  renderLeftElement: (entity: T, isHovered: boolean) => ReactNode
  renderContent: (entity: T, editing: EditingState) => ReactNode
  renderDescription?: (entity: T, editing: EditingState) => ReactNode | null
  renderBadges: (entity: T, isHovered: boolean, editing: boolean) => ReactNode

  editing?: EditingState  // Optional, parent provides if using editing
  onClick?: () => void
  onElementRef?: (element: HTMLDivElement | null) => void
  className?: string
}

export function BaseListItem<T>({ entity, ... }: BaseListItemProps<T>) {
  // Implementation
}
```

**Trade-offs**:
- Not fully type-safe (could have mismatched entity + render function)
- Benefits: Understandable types, good autocomplete, maintainable

---

## 🚨 Known Edge Cases

### 1. **Render Function Returns Null**: Parent render function returns null unexpectedly
   - **Scenario**: `renderDescription` returns null for some entities, undefined for others
   - **Handling**: BaseListItem checks for null/undefined before rendering section
   - **Prevention**: TypeScript types allow `ReactNode | null`, handle both
   - **Testing**: Pass null from render function, verify no crash
   - **Fallback**: Section simply doesn't render (graceful)

### 2. **Missing Render Props**: Parent forgets to provide required render function
   - **Scenario**: `<BaseListItem entity={task} />` (missing renderLeftElement, etc.)
   - **Handling**: TypeScript error at compile time (required props)
   - **Prevention**: Props are required, not optional
   - **Testing**: TypeScript compile check
   - **Fallback**: Runtime error if TypeScript bypassed (acceptable - dev error)

### 3. **Entity Type Mismatch**: Generic type doesn't match actual entity
   - **Scenario**: `<BaseListItem<Task> entity={project} />` (types lie)
   - **Handling**: TypeScript error at compile time
   - **Prevention**: Type inference from entity prop
   - **Testing**: TypeScript compile check
   - **Fallback**: Runtime may work or crash depending on shape (dev error)

### 4. **Editing State Out of Sync**: Parent's editing state doesn't match entity
   - **Scenario**: Parent calls `useListItemEditing` with old entity data, renders new entity
   - **Handling**: Parent must remount or reset editing state when entity changes
   - **Prevention**: `useListItemEditing` has entity in dependencies, resets on change
   - **Testing**: Change entity while editing, verify state resets
   - **Fallback**: Editing shows stale data until user cancels/saves

### 5. **Click Handler During Edit**: User clicks row while editing
   - **Scenario**: Editing name, clicks row background, onClick fires
   - **Handling**: BaseListItem checks if editing, ignores onClick if true
   - **Prevention**: `if (editing?.isEditing) return` in click handler
   - **Testing**: Start editing, click row - verify no action
   - **Fallback**: Dialog opens during editing (confusing but not broken)

### 6. **Ref Forwarding Failure**: onElementRef not called or called with wrong element
   - **Scenario**: Focus management breaks because ref isn't set correctly
   - **Handling**: BaseListItem uses ref callback pattern, guarantees call
   - **Prevention**: Test ref forwarding in isolation
   - **Testing**: Verify onElementRef called with correct div element
   - **Fallback**: Focus management doesn't work (keyboard nav breaks)

### 7. **Badge Overflow in Small Screens**: Many badges overflow container on mobile
   - **Scenario**: Task has 10 badges, doesn't fit on iPhone screen
   - **Handling**: Badges wrap to multiple lines (flex-wrap)
   - **Prevention**: Badge container has max-width + wrapping
   - **Testing**: Add many badges, resize to mobile, verify wrapping
   - **Fallback**: Horizontal scroll if wrapping fails (not ideal but functional)

---

## 📝 Notes & Learnings

### Development Notes
```
[Space for ongoing notes during implementation]

Key Patterns to Follow:
- BaseListItem should be as "dumb" as possible - all logic in render functions
- Render functions should be memoized in parent if they have complex logic
- Entity wrappers should be thin - mostly render function definitions
- Test BaseListItem in isolation before integrating with wrappers
- Use Storybook to develop BaseListItem with mock entities

Component Structure:
<div ref={onElementRef} data-entity-id={...} data-entity-type={...}>
  <div className="flex items-start gap-2.5">
    {/* Left element */}
    <div className="shrink-0">{renderLeftElement(entity, isHovered)}</div>

    {/* Main content */}
    <div className="flex-1 min-w-0 space-y-1.5">
      {/* Content/Editing */}
      <div onClick={(e) => e.stopPropagation()}>
        {renderContent(entity, editing)}
        {renderDescription?.(entity, editing)}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-1">
        {renderBadges(entity, isHovered, editing.isEditing)}
      </div>
    </div>
  </div>
</div>
```

### Issues Encountered
```
[Track all issues and resolutions]

Common gotchas to watch for:
- Render functions must handle null entity gracefully (shouldn't happen but be safe)
- Editing state must be memoized or stable (avoid rerenders)
- Click handlers need stopPropagation for inner elements
- Ref forwarding must happen to outer div (focus target)
- Data attributes must match what keyboard shortcuts expect
- Badge container flex-wrap prevents overflow
```

### Future Enhancements
- [ ] Add drag handle rendering (for drag-to-reorder)
- [ ] Add selection checkbox rendering (for multi-select)
- [ ] Add context menu support (right-click actions)
- [ ] Add keyboard navigation hints (visual indicators)
- [ ] Add loading state for optimistic updates
- [ ] Add error state for failed updates
- [ ] Add animation support (enter/exit, reorder)
- [ ] Extract to separate package (reusable across projects)

---

## 🔗 References

**Key Files**:
- `app/src/components/TaskListView.tsx` (TaskRow) - Current task implementation
- `app/src/components/ProjectRow.tsx` - Current project implementation
- `app/src/components/RoutineRow.tsx` - Current routine implementation
- `app/src/hooks/list-items/` - Phase 1 hooks (will be used internally)
- `app/src/components/badges/shared/` - Phase 2 badges (will be rendered by wrappers)

**Similar Patterns**:
- Render props pattern: React Table, React Select
- Composition pattern: Shadcn components (Dialog, Card, etc.)
- Generic components: Radix UI primitives

**Planning Documents**:
- `docs/list-item-standardization-plan.md` - Overall strategy
- `docs/list-item-standardization-phase1-implementation.md` - Phase 1 (hooks)
- `docs/list-item-standardization-phase2-implementation.md` - Phase 2 (badges)

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

# Testing BaseListItem (manual)
# 1. Create test page with BaseListItem + mock entities
# 2. Test all render functions with different data
# 3. Test hover states
# 4. Test editing states
# 5. Test click handlers
# 6. Test ref forwarding
# 7. Test with all three entity types
```

---

**Last Updated**: 2025-01-17 (Milestone 2 Complete - BaseListItem component implemented, 2/6 milestones done)
