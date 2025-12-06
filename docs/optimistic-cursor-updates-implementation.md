# Optimistic Cursor Updates - Implementation Plan

## Project Overview

**Goal**: When entities are optimistically updated and no longer match the current view's filter criteria (priority, label, date, project), the cursor/selection should automatically move to the next item.

**Problem**: Currently only task completion and project reassignment trigger cursor updates. Priority changes, label changes, and date changes don't move the cursor, leaving it on an item that's no longer visible in the filtered view.

**Solution**: Extract server-side filter predicates into shared utilities and re-evaluate entity visibility after optimistic updates. This creates a single source of truth that automatically handles all current and future combinations of update types × filter types.

**Success Criteria**:
- ✅ Cursor moves when priority changes remove task from priority-filtered view
- ✅ Cursor moves when label changes remove task from label-filtered view
- ✅ Cursor moves when date changes remove task from time-filtered view
- ✅ Existing task completion and project move still work
- ✅ No manual mapping of update types to filter types required
- ✅ Filter logic shared between server and client (single source of truth)

---

## Progress Tracking

**Overall Completion**: 0% (0/6 milestones)

- [ ] Milestone 1: Extract Shared Filter Predicates (Backend)
- [ ] Milestone 2: Client Filter Matcher Utility
- [ ] Milestone 3: Apply Optimistic Updates Helper
- [ ] Milestone 4: Update TaskListItem with Filter Detection
- [ ] Milestone 5: Thread Query Through Component Tree
- [ ] Milestone 6: Testing & Validation

---

## Implementation Milestones

### Milestone 1: Extract Shared Filter Predicates (Backend)

**Goal**: Create pure filter predicate functions that work in both server and client contexts.

**Tasks**:
1. Create `convex/todoist/helpers/cursorFilters.ts`
2. Extract project filter predicate from `getFilteredActiveItems.ts`
3. Extract priority filter predicate from `getFilteredActiveItems.ts`
4. Extract label filter predicate from `getFilteredActiveItems.ts`
5. Extract today filter predicate from `getDueTodayItems.ts`
6. Extract next 7 days filter predicate from `getDueNext7DaysItems.ts`
7. Add TypeScript types for minimal entity shapes (structural typing)
8. Export all predicates as pure functions

**Success Criteria**:
- ✅ `cursorFilters.ts` file created with all predicate functions
- ✅ Functions are pure (no database access, no side effects)
- ✅ Functions use structural typing (accept minimal entity shapes)
- ✅ TypeScript compilation succeeds with no errors
- ✅ Functions can be imported from both server and client code

**Files to Create** (1):
- `convex/todoist/helpers/cursorFilters.ts` - Pure filter predicate functions

**Files to Reference**:
- `convex/todoist/internalQueries/getFilteredActiveItems.ts` - Source for project/priority/label filters
- `convex/todoist/queries/getDueTodayItems.ts` - Source for today filter
- `convex/todoist/queries/getDueNext7DaysItems.ts` - Source for next 7 days filter
- `convex/todoist/helpers/queueEngine.ts` - Reference pattern for filter functions (lines 90-260)

**Completion Notes Template**:
```markdown
Date: YYYY-MM-DD
Status: [COMPLETED/BLOCKED/IN PROGRESS]

Notes:
- Created cursorFilters.ts with X filter predicate functions
- Extracted logic from [list specific server files]
- Used structural typing for entity parameters: [list types]
- [Any implementation decisions or challenges]

Test Results:
- [ ] TypeScript typecheck: 0 errors
- [ ] Can import from server context: [test method]
- [ ] Can import from client context: [test method]
- [ ] User verified: [what user tested]

Files Created:
- convex/todoist/helpers/cursorFilters.ts (X lines) - [brief description]

Issues Encountered:
- [List any issues and resolutions]

Next Steps for Milestone 2:
- Create client filter matcher that dispatches to these predicates
- Import cursorFilters via relative path from app/src
```

---

### Milestone 2: Client Filter Matcher Utility

**Goal**: Create client-side utility that dispatches to appropriate filter predicate based on query type.

**Tasks**:
1. Create `app/src/lib/cursor/filters.ts`
2. Import filter predicates from `convex/todoist/helpers/cursorFilters.ts` (relative import)
3. Implement `matchesViewFilter(query, entity)` function
4. Add switch statement on `query.type` to dispatch to correct predicate
5. Handle all query types: inbox, project, priority, label, time
6. Add fallback for unknown query types (return true)
7. Add TypeScript types using `ListQueryInput` from `@/lib/views/types`

**Success Criteria**:
- ✅ `filters.ts` created with `matchesViewFilter()` export
- ✅ Handles all `ListQueryInput` discriminated union cases
- ✅ Uses shared predicates from Milestone 1 (no logic duplication)
- ✅ TypeScript compilation succeeds with no errors
- ✅ User can call function with sample query and entity

**Files to Create** (1):
- `app/src/lib/cursor/filters.ts` - Client filter matcher

**Files to Reference**:
- `app/src/lib/priorities.ts` - Reference pattern for client re-export (lines 1-11)
- `app/src/lib/views/types.ts` - `ListQueryInput` type definition (lines 48-58)
- `app/src/types/convex/todoist.ts` - Entity type definitions

**Completion Notes Template**:
```markdown
Date: YYYY-MM-DD
Status: [COMPLETED/BLOCKED/IN PROGRESS]

Notes:
- Created filters.ts with matchesViewFilter() function
- Imports shared predicates via: [show import path]
- Handles X query types: [list types]
- Fallback behavior: [describe]

Test Results:
- [ ] TypeScript typecheck: 0 errors
- [ ] Manual test with priority query: [result]
- [ ] Manual test with label query: [result]
- [ ] User verified: [what user tested]

Files Created:
- app/src/lib/cursor/filters.ts (X lines) - [brief description]

Issues Encountered:
- [List any issues and resolutions]

Next Steps for Milestone 3:
- Create helper to apply optimistic updates to entities
- Will be used by entity removal detection logic
```

---

### Milestone 3: Apply Optimistic Updates Helper

**Goal**: Create utility function that combines base entity + optimistic update to produce display entity.

**Tasks**:
1. Create `app/src/lib/cursor/applyOptimisticUpdate.ts`
2. Implement `applyOptimisticTaskUpdate(task, update)` function
3. Handle all `OptimisticTaskUpdate` types: priority-change, label-change, project-move, due-change, etc.
4. Use same ternary pattern as TaskListItem (lines 63-99)
5. Return new entity object with optimistic values applied
6. Add proper TypeScript types for task and update parameters

**Success Criteria**:
- ✅ `applyOptimisticUpdate.ts` created with task update function
- ✅ Handles all optimistic update types from `OptimisticUpdatesContext`
- ✅ Returns entity with optimistic values applied (immutable pattern)
- ✅ TypeScript compilation succeeds with no errors
- ✅ User can test function with sample task and update

**Files to Create** (1):
- `app/src/lib/cursor/applyOptimisticUpdate.ts` - Apply optimistic updates to entities

**Files to Reference**:
- `app/src/components/list-items/TaskListItem.tsx` - Current application pattern (lines 63-99)
- `app/src/contexts/OptimisticUpdatesContext.tsx` - `OptimisticTaskUpdate` type (lines 7-50)

**Completion Notes Template**:
```markdown
Date: YYYY-MM-DD
Status: [COMPLETED/BLOCKED/IN PROGRESS]

Notes:
- Created applyOptimisticUpdate.ts with applyOptimisticTaskUpdate()
- Handles X update types: [list types]
- Follows immutable pattern: [describe approach]
- Matches TaskListItem ternary logic: [confirm]

Test Results:
- [ ] TypeScript typecheck: 0 errors
- [ ] Test priority-change: [result]
- [ ] Test label-change: [result]
- [ ] User verified: [what user tested]

Files Created:
- app/src/lib/cursor/applyOptimisticUpdate.ts (X lines) - [brief description]

Issues Encountered:
- [List any issues and resolutions]

Next Steps for Milestone 4:
- Update TaskListItem to use both filters.ts and applyOptimisticUpdate.ts
- Replace manual shouldRemove logic with filter re-evaluation
```

---

### Milestone 4: Update TaskListItem with Filter Detection

**Goal**: Replace manual `shouldRemove` logic with automatic filter re-evaluation.

**Tasks**:
1. Add `query: ListQueryInput` prop to `TaskListItemProps`
2. Import `matchesViewFilter` from `@/lib/cursor/filters`
3. Import `applyOptimisticTaskUpdate` from `@/lib/cursor/applyOptimisticUpdate`
4. Replace existing `shouldRemove` useEffect (lines 104-112)
5. New logic: Apply optimistic update → check filter match → call onEntityRemoved if no match
6. Keep `isProjectView` prop for now (can remove in future cleanup)
7. Ensure early return for task-complete still works

**Success Criteria**:
- ✅ TaskListItem accepts `query` prop
- ✅ Manual `shouldRemove` logic removed
- ✅ Filter re-evaluation logic implemented in useEffect
- ✅ TypeScript compilation succeeds with no errors
- ✅ User can manually test that cursor still moves on task completion

**Files to Modify** (1):
- `app/src/components/list-items/TaskListItem.tsx`
  - Add `query` to props interface (line ~30)
  - Replace useEffect logic (lines 104-112)
  - Import new utilities

**Files to Reference**:
- `app/src/lib/cursor/filters.ts` - Milestone 2
- `app/src/lib/cursor/applyOptimisticUpdate.ts` - Milestone 3

**Completion Notes Template**:
```markdown
Date: YYYY-MM-DD
Status: [COMPLETED/BLOCKED/IN PROGRESS]

Notes:
- Added query prop to TaskListItemProps
- Replaced manual shouldRemove with: [describe new logic]
- Removed X lines of manual checks
- Added X lines of filter re-evaluation
- Task completion still triggers early return: [confirm]

Test Results:
- [ ] TypeScript typecheck: 0 errors
- [ ] Manual test: Complete task → cursor moves (existing behavior)
- [ ] Query prop passed: [how verified]
- [ ] User verified: [what user tested]

Files Modified:
- app/src/components/list-items/TaskListItem.tsx
  - Added query prop (line X)
  - Replaced useEffect (lines X-Y, Z lines changed)
  - Added imports (lines X-Y)

Issues Encountered:
- [List any issues and resolutions]

Next Steps for Milestone 5:
- Thread query prop through BaseListView to TaskListItem
- Update TaskListView to pass list.query to BaseListView
- Update renderRow signature to include query parameter
```

---

### Milestone 5: Thread Query Through Component Tree

**Goal**: Pass `list.query` from view components through BaseListView to list items.

**Tasks**:
1. Add `query: ListQueryInput` to `BaseListViewProps` interface
2. Update `renderRow` prop signature to include query parameter
3. Pass query to renderRow calls in both grouped and flat rendering
4. Update `TaskListView.tsx` to pass `list.query` to BaseListView
5. Update `TaskListView.tsx` renderRow to pass query to TaskListItem
6. Update `ProjectsListView.tsx` (same pattern)
7. Update `RoutinesListView.tsx` (same pattern)

**Success Criteria**:
- ✅ BaseListView accepts and threads query prop
- ✅ TaskListView passes list.query to BaseListView and TaskListItem
- ✅ ProjectsListView passes list.query (if applicable)
- ✅ RoutinesListView passes list.query (if applicable)
- ✅ TypeScript compilation succeeds with no errors
- ✅ User can see query prop reaching TaskListItem in React DevTools

**Files to Modify** (4):
- `app/src/components/list-items/BaseListView.tsx`
  - Add query to props (line ~120)
  - Update renderRow signature (line ~145)
  - Pass query in grouped rendering (line ~489)
  - Pass query in flat rendering (line ~517)
- `app/src/components/TaskListView.tsx`
  - Pass query={list.query} to BaseListView (line ~95)
  - Pass query to TaskListItem in renderRow (line ~115)
- `app/src/components/ProjectsListView.tsx`
  - Same pattern if project filtering views exist
- `app/src/components/RoutinesListView.tsx`
  - Same pattern if routine filtering views exist

**Completion Notes Template**:
```markdown
Date: YYYY-MM-DD
Status: [COMPLETED/BLOCKED/IN PROGRESS]

Notes:
- Added query prop to BaseListView at line X
- Updated renderRow signature: [show new signature]
- Updated X call sites in BaseListView: [list locations]
- Updated TaskListView to pass query: [line numbers]
- [Projects/Routines status: updated/skipped/not applicable]

Test Results:
- [ ] TypeScript typecheck: 0 errors
- [ ] React DevTools: query prop visible in TaskListItem
- [ ] Verified query value matches list.query: [how]
- [ ] User verified: [what user tested]

Files Modified:
- app/src/components/list-items/BaseListView.tsx (X lines changed)
- app/src/components/TaskListView.tsx (X lines changed)
- [Other files if applicable]

Issues Encountered:
- [List any issues and resolutions]

Next Steps for Milestone 6:
- Test all filter type combinations
- Verify cursor movement for priority, label, date changes
- Test edge cases (last item, empty lists, etc.)
```

---

### Milestone 6: Testing & Validation

**Goal**: Comprehensive testing of cursor movement across all filter types and edge cases.

**Tasks**:
1. Test priority filter: Change P1→P2 in P1 view → cursor moves
2. Test priority filter: Change P2→P1 in P1 view → cursor moves
3. Test label filter: Remove filtered label → cursor moves
4. Test label filter: Replace filtered label with different label → cursor moves
5. Test date filter: Change due date from today to tomorrow in Today view → cursor moves
6. Test project filter: Verify existing behavior still works
7. Test task completion: Verify existing behavior still works
8. Test edge case: Last item removed → cursor moves to previous list or nulls
9. Test edge case: Multiple optimistic updates in sequence
10. Run typecheck and tests

**Success Criteria**:
- ✅ All priority filter test cases pass
- ✅ All label filter test cases pass
- ✅ All date filter test cases pass
- ✅ Existing project filter and completion behavior unchanged
- ✅ Edge cases handled gracefully
- ✅ TypeScript typecheck: 0 errors
- ✅ All tests pass (if any exist)
- ✅ User verified system works end-to-end

**Testing Checklist**:

**Priority Filters**:
- [ ] P1 view: Change P1 task to P2 → cursor moves to next task
- [ ] P2 view: Change P2 task to P1 → cursor moves to next task
- [ ] P1 view: Change P2 task to P3 → cursor doesn't move (task not in view)

**Label Filters**:
- [ ] "urgent" view: Remove "urgent" label → cursor moves to next task
- [ ] "urgent" view: Add "work" label → cursor stays (still has "urgent")
- [ ] "urgent" view: Replace "urgent" with "work" → cursor moves to next task

**Date Filters**:
- [ ] Today view: Change due date to tomorrow → cursor moves to next task
- [ ] Next 7 days view: Change due date to next month → cursor moves to next task
- [ ] Today view: Change task that wasn't in view → cursor doesn't move

**Project Filters (Regression)**:
- [ ] Project A view: Move task to Project B → cursor moves (existing behavior)
- [ ] Inbox view: Move task to different project → verify behavior

**Task Completion (Regression)**:
- [ ] Any view: Complete task → cursor moves to next task (existing behavior)

**Edge Cases**:
- [ ] Remove last item in list → cursor moves to previous list or nulls selection
- [ ] Remove last item in last list → cursor nulls selection
- [ ] Rapid multiple updates → cursor updates correctly
- [ ] Optimistic update reverted by server → cursor handles gracefully

**Completion Notes Template**:
```markdown
Date: YYYY-MM-DD
Status: [COMPLETED/BLOCKED/IN PROGRESS]

Notes:
- Completed comprehensive testing across all filter types
- Priority filters: X/X tests passed
- Label filters: X/X tests passed
- Date filters: X/X tests passed
- Regression tests: X/X passed
- Edge cases: X/X passed

Test Results:
- [ ] TypeScript typecheck: 0 errors
- [ ] All manual test cases: [summary]
- [ ] User acceptance: [user feedback]

Issues Found & Fixed:
- [List any bugs discovered during testing and how they were fixed]

Performance Notes:
- [Any performance observations]
- [Filter evaluation speed]

User Verification:
- [What the user tested and approved]
- [Any user feedback or requests]

Project Complete:
- All success criteria met: [Yes/No]
- Ready for production: [Yes/No]
```

---

## File Inventory

### New Files to Create (3)

1. **`convex/todoist/helpers/cursorFilters.ts`** (~150 lines)
   - Purpose: Pure filter predicate functions shared between server and client
   - Exports: `matchesProjectFilter`, `matchesPriorityFilter`, `matchesLabelFilter`, `matchesTodayFilter`, `matchesNext7DaysFilter`
   - Pattern: Pure functions taking entity and filter value, returning boolean

2. **`app/src/lib/cursor/filters.ts`** (~80 lines)
   - Purpose: Client-side filter matcher that dispatches to predicates
   - Exports: `matchesViewFilter(query, entity)`
   - Pattern: Switch on query.type, call appropriate predicate

3. **`app/src/lib/cursor/applyOptimisticUpdate.ts`** (~100 lines)
   - Purpose: Apply optimistic updates to entities for filter evaluation
   - Exports: `applyOptimisticTaskUpdate(task, update)`
   - Pattern: Switch on update.type, return entity with optimistic values

### Files to Modify (7)

1. **`app/src/components/list-items/TaskListItem.tsx`**
   - Changes: Add query prop, replace manual shouldRemove with filter re-evaluation
   - Lines affected: ~15 (prop interface + useEffect replacement)

2. **`app/src/components/list-items/BaseListView.tsx`**
   - Changes: Add query prop, update renderRow signature, pass query to calls
   - Lines affected: ~10 (interface + 2 call sites)

3. **`app/src/components/TaskListView.tsx`**
   - Changes: Pass list.query to BaseListView and TaskListItem
   - Lines affected: ~5 (2 prop additions)

4. **`app/src/components/ProjectsListView.tsx`**
   - Changes: Same pattern as TaskListView (if applicable)
   - Lines affected: ~5

5. **`app/src/components/RoutinesListView.tsx`**
   - Changes: Same pattern as TaskListView (if applicable)
   - Lines affected: ~5

6. **`app/src/components/list-items/ProjectListItem.tsx`** (Optional)
   - Changes: Add filter detection if priority-filtered project views exist
   - Lines affected: ~15 (same pattern as TaskListItem)

7. **`app/src/components/list-items/RoutineListItem.tsx`** (Optional)
   - Changes: Add filter detection if filtered routine views exist
   - Lines affected: ~15 (same pattern as TaskListItem)

**Total**: 3 new files, 4-7 modified files, ~200-250 lines of new code, ~40-60 lines modified

---

## Technical Decisions

### 1. Shared Code Architecture

**Decision**: Use relative imports from `app/src` to `convex/` for shared code

**Rationale**:
- Follows existing pattern (see `app/src/lib/priorities.ts` importing from `convex/todoist/types/priorities.ts`)
- Single source of truth - filter logic defined once in convex/
- No code duplication between server and client
- TypeScript resolves imports correctly in both contexts

**Alternative Considered**: Create `convex/shared/` directory
- Rejected: Not consistent with existing codebase patterns
- Current approach works well with no changes to build config

### 2. Filter Predicate Design

**Decision**: Pure functions with structural typing

**Rationale**:
- Works in both server (full Doc<"todoist_items">) and client (TodoistTaskWithProject) contexts
- No side effects or database access
- Easy to test in isolation
- Follows functional programming principles

**Pattern**:
```typescript
export function matchesPriorityFilter(
  entity: { priority: number },
  targetPriority: number
): boolean {
  return entity.priority === targetPriority
}
```

**Alternative Considered**: Class-based filter system
- Rejected: Adds complexity, not consistent with codebase functional style

### 3. Filter Re-evaluation Timing

**Decision**: Re-evaluate filter match in useEffect when optimistic update changes

**Rationale**:
- Matches existing pattern in TaskListItem (lines 104-112)
- Triggers only when optimistic update is added/changed
- Synchronous check prevents race conditions
- Cursor update happens before next render

**Pattern**:
```typescript
useEffect(() => {
  if (!optimisticUpdate || !onEntityRemoved) return

  const updatedEntity = applyOptimisticTaskUpdate(task, optimisticUpdate)
  const stillMatchesFilter = matchesViewFilter(query, updatedEntity)

  if (!stillMatchesFilter) {
    onEntityRemoved(listId, task.todoist_id)
  }
}, [optimisticUpdate, query, task, listId, onEntityRemoved])
```

**Alternative Considered**: Check in render phase
- Rejected: Render should be pure, cursor updates are side effects

### 4. Query Prop Threading

**Decision**: Pass `list.query` explicitly through component tree

**Rationale**:
- Explicit data flow (React best practice)
- TypeScript ensures query reaches components that need it
- Easy to debug - query visible in React DevTools
- No context needed (simpler than adding QueryContext)

**Alternative Considered**: Create QueryContext
- Rejected: Adds complexity, prop drilling is only 2 levels deep

### 5. Optimistic Update Application

**Decision**: Extract application logic into pure function

**Rationale**:
- Reusable between render logic and filter evaluation
- Single source of truth for how updates apply
- Easy to test in isolation
- Matches ternary pattern already used in TaskListItem

**Alternative Considered**: Duplicate logic in both places
- Rejected: Violates DRY principle, maintenance burden

---

## Edge Cases & Handling

### 1. Last Item in List Removed

**Scenario**: User changes priority of last remaining task in P1 view from P1 to P2

**Handling**:
- `handleEntityRemoved` in `useTaskSelection` already handles this (lines 39-63)
- When `entities.length === 0`, moves to next or previous list
- If no other lists, nulls selection: `{ listId: null, entityId: null }`

**No changes needed**: Existing cursor logic handles gracefully

### 2. Multiple Rapid Optimistic Updates

**Scenario**: User rapidly changes priority P1→P2→P3 before server responds

**Handling**:
- Each optimistic update gets unique timestamp
- useEffect runs for each update change
- Filter re-evaluation uses latest optimistic update
- Cursor moves only once (when first update removes from view)
- Subsequent updates on already-removed item are no-ops

**No special handling needed**: React batching and timestamp ordering work correctly

### 3. Optimistic Update Reverted

**Scenario**: Server rejects priority change, optimistic update removed from context

**Handling**:
- When optimistic update cleared, entity returns to original state
- If entity still matches original filter, no cursor movement
- If entity was never in view (edge case), cursor already moved away
- `useOptimisticSync` hook clears updates when server data matches (lines 128-188)

**No special handling needed**: Existing optimistic update infrastructure handles rollbacks

### 4. Unknown Query Type

**Scenario**: New filter type added but not yet implemented in `matchesViewFilter`

**Handling**:
```typescript
default:
  return true // Unknown filter type, don't remove entity
```
- Conservative approach: Keep entity visible
- Prevents cursor jumping erroneously
- Dev can add new filter type incrementally

**Degrades gracefully**: Feature incomplete but doesn't break existing functionality

### 5. Entity Not in View Initially

**Scenario**: Task with P2 priority in P1 view (shouldn't be visible anyway)

**Handling**:
- Filter re-evaluation returns false (correct)
- `onEntityRemoved` called but entity not in `visibleEntities` array
- `useTaskSelection` checks if removed entity was focused (line 43): `if (prev.entityId !== removedEntityId) return prev`
- Cursor doesn't move (correct behavior)

**No special handling needed**: Cursor only moves if focused entity removed

### 6. Time Filter Edge Cases

**Scenario**: Task due "today" at 11:59 PM, user changes time to 12:01 AM (tomorrow)

**Handling**:
- Date filter predicates use timezone-aware comparison
- Extract exact logic from server queries (`getDueTodayItems.ts`)
- If server considers it not matching, client will too
- Consistency guaranteed by shared predicate functions

**Important**: Date filters more complex than simple equality checks
- Must handle timezone offset
- Must handle date parsing
- Must match server behavior exactly

---

## Dependencies & Prerequisites

### External Dependencies
- None (all internal code)

### Existing Infrastructure Required
- ✅ `useTaskSelection` hook (cursor management)
- ✅ `OptimisticUpdatesContext` (optimistic update storage)
- ✅ `BaseListView` component (entity rendering and callbacks)
- ✅ `onEntityRemoved` callback pattern (already implemented)

### Knowledge Prerequisites
- Understanding of discriminated unions in TypeScript
- React useEffect hook patterns
- Pure function design
- Structural typing concepts

---

## Testing Strategy

### Unit Testing (Manual)

**Filter Predicates**:
```typescript
// Test in browser console or Convex dashboard
matchesPriorityFilter({ priority: 1 }, 1) // Should return true
matchesPriorityFilter({ priority: 2 }, 1) // Should return false
matchesLabelFilter({ labels: ['urgent', 'work'] }, 'urgent') // Should return true
```

**Filter Matcher**:
```typescript
const query = { type: 'priority', priority: 1, view: 'view:priority:p1' }
const task = { priority: 1, /* other fields */ }
matchesViewFilter(query, task) // Should return true
```

### Integration Testing (Manual)

**Test in UI**:
1. Navigate to P1 priority view
2. Select a P1 task (focus it with arrow keys)
3. Press 'p' to open priority dialog
4. Change priority to P2
5. Verify cursor moves to next task immediately

**Repeat for**:
- Label changes in label views
- Date changes in date views
- Project changes in project views
- Task completion (regression test)

### Regression Testing

**Existing Features to Verify**:
- ✅ Task completion → cursor moves (any view)
- ✅ Project move → cursor moves (project views)
- ✅ Arrow key navigation still works
- ✅ Click selection still works
- ✅ Keyboard shortcuts still trigger on focused item

---

## Rollback Plan

**If issues discovered after deployment:**

1. **Milestone 5 rollback**:
   - Remove `query` prop from view components
   - Revert BaseListView renderRow signature
   - System returns to Milestone 4 state (TaskListItem has new logic but query always undefined)

2. **Milestone 4 rollback**:
   - Restore original `shouldRemove` logic in TaskListItem
   - Remove imports of filter utilities
   - System returns to original manual checking behavior

3. **Complete rollback**:
   - Delete 3 new files
   - Revert 7 modified files
   - System returns to pre-project state

**Each milestone is independently committable** - partial rollback is safe

---

## Future Enhancements

**After this implementation is complete:**

1. **Extract Project/Routine Application Functions**
   - Create `applyOptimisticProjectUpdate()` and `applyOptimisticRoutineUpdate()`
   - Apply same pattern to ProjectListItem and RoutineListItem

2. **Combine Filter Evaluation with Optimistic Sync**
   - Merge filter re-evaluation logic into `useOptimisticSync` hook
   - Single hook handles both sync clearing and cursor updates

3. **Add Filter Composition**
   - Support multi-criteria filters (e.g., "P1 tasks in Work project")
   - Compose predicates: `and(matchesPriority(...), matchesProject(...))`

4. **Performance Optimization**
   - Memoize filter evaluation if performance issues observed
   - Cache filter results for unchanged entities

5. **Analytics**
   - Track which filters trigger most cursor updates
   - Monitor user behavior around filtered views

---

## Success Metrics

**Functional Success**:
- ✅ Cursor moves correctly for 100% of filter type + update type combinations
- ✅ No regressions in existing cursor behavior
- ✅ TypeScript compilation with 0 errors
- ✅ All manual test cases pass

**Code Quality Success**:
- ✅ Single source of truth for filter logic (no duplication)
- ✅ Pure functions with no side effects
- ✅ Clear, maintainable code following existing patterns
- ✅ Comprehensive completion notes for future maintenance

**User Experience Success**:
- ✅ Instant cursor movement (no perceived delay)
- ✅ Cursor always lands on valid next item
- ✅ No flickering or visual glitches
- ✅ Behavior feels natural and predictable

---

## Notes for Future Implementers

**Reading this plan for the first time?**

1. **Start with Milestone 1**: The backend filter predicates are the foundation
2. **Follow the order**: Each milestone builds on previous work
3. **Read completion notes**: Previous agent's notes contain critical context
4. **Test after each milestone**: Don't batch multiple milestones without verification
5. **Ask user for approval**: Never commit without user verification

**Key files to understand before starting**:
- `app/src/lib/priorities.ts` - Shared code pattern reference
- `app/src/components/list-items/TaskListItem.tsx` - Current optimistic update pattern
- `convex/todoist/helpers/queueEngine.ts` - Filter function pattern reference

**Common pitfalls to avoid**:
- ❌ Don't create `convex/shared/` directory (not consistent with codebase)
- ❌ Don't use React Context for query passing (prop drilling is cleaner)
- ❌ Don't skip the "apply optimistic update" helper (needed for consistent logic)
- ❌ Don't test only in one filter type (test all: priority, label, date, project)

**Remember**: This plan is optimized for **agent handoffs**. Write completion notes as if the next agent knows nothing about your work.
