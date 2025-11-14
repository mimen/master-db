# Optimistic Updates Implementation Plan

## Current State Audit

### ✅ Has Optimistic Updates
- **TaskListView.tsx** - Content/Description editing
  - Pattern: UI-level `useState` for optimistic values
  - Clears when DB updates via Convex reactivity
  - Rollback on failure

### ❌ Missing Optimistic Updates

#### High Impact (Visible state changes)
1. **Task Completion** - Removes task from view
   - DialogManager.tsx:134-146
   - TaskListView.tsx:395-397
   - **Impact**: Task should disappear immediately
   - **Current**: Waits 200-500ms for API → DB → Query

2. **Task Deletion** - Removes task from view
   - DialogManager.tsx:148-160
   - **Impact**: Task should disappear immediately
   - **Current**: Waits 200-500ms

3. **Priority Changes** - Visual flag color changes
   - DialogManager.tsx:68-79
   - PrioritySelector.tsx:46-59
   - **Impact**: Flag color should change immediately
   - **Current**: Waits for full round-trip

4. **Label Changes** - Badge additions/removals
   - DialogManager.tsx:94-105
   - LabelSelector.tsx:45-60
   - **Impact**: Badges should appear/disappear immediately
   - **Current**: Waits for full round-trip

#### Medium Impact (Affects filtering/organization)
5. **Project Moves** - May change which list shows task
   - DialogManager.tsx:81-92
   - ProjectSelector.tsx:42-52
   - **Impact**: Task may need to move between lists
   - **Current**: Waits for full round-trip

6. **Due Date Changes** - Badge update
   - DialogManager.tsx:107-118
   - **Impact**: Due date badge should update immediately
   - **Current**: Waits for full round-trip

7. **Deadline Changes** - Badge update
   - DialogManager.tsx:120-132
   - **Impact**: Deadline badge should update immediately
   - **Current**: Waits for full round-trip

## Optimistic Update Strategy

### Tier 1: UI-Level Optimistic (Simple)
**Best for**: Visual changes that don't affect business logic

**Pattern**:
```typescript
const [optimisticValue, setOptimisticValue] = useState<T | null>(null)

// On change:
setOptimisticValue(newValue)
await action(...)
if (failed) setOptimisticValue(null)

// Clear when DB updates:
useEffect(() => {
  if (optimisticValue !== null) setOptimisticValue(null)
}, [task.actualValue])

// Display:
const display = optimisticValue ?? task.actualValue
```

**Good for**:
- Priority changes (flag color)
- Label changes (badges)
- Due date changes (badge text)
- Content/description (already implemented)

### Tier 2: Query-Level Optimistic (Advanced)
**Best for**: Operations that remove/hide tasks from view

**Pattern**: Use Convex's optimistic updates via local state + query filtering

**Good for**:
- Task completion (removes from active list)
- Task deletion (removes from all lists)
- Project moves (may remove from current list)

### Design: Extended useTodoistAction Hook

```typescript
interface OptimisticConfig<T> {
  // UI-level optimistic value
  getOptimisticValue?: () => T

  // Query-level: temporarily hide task
  hideTask?: boolean

  // Rollback strategy
  onRollback?: () => void
}

interface TodoistActionConfig<T> {
  loadingMessage: string
  successMessage: string
  errorMessage?: string
  optimistic?: OptimisticConfig<T>
}
```

## Implementation Priority

### Phase 1: High-Impact Visual Changes (Quick Wins)
1. ✅ Content/Description (already done)
2. Priority changes → UI-level optimistic
3. Label changes → UI-level optimistic
4. Due date changes → UI-level optimistic

### Phase 2: Task Removals (Complex)
5. Task completion → Query-level optimistic
6. Task deletion → Query-level optimistic

### Phase 3: List Changes (Most Complex)
7. Project moves → Hybrid approach

## Success Criteria
- All visual changes appear instantly (<16ms)
- Failed actions roll back gracefully
- No data inconsistencies
- Maintains single source of truth (Convex DB)
- Pattern is easy to extend for future features

## Files to Modify
1. `/app/src/hooks/useTodoistAction.ts` - Extend with optimistic support
2. `/app/src/components/TaskListView.tsx` - Use extended hook
3. `/app/src/components/dialogs/DialogManager.tsx` - Use extended hook
4. `/app/src/components/dropdowns/*.tsx` - Use extended hook

## Testing Strategy
1. Test each optimistic update in isolation
2. Test rollback on API failure
3. Test concurrent updates (race conditions)
4. Test with slow network (throttle to 3G)
5. Visual verification with Chrome Dev Tools MCP
