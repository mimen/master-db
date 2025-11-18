# Routines Sidebar Section - Implementation Plan

**Project**: Add "Routines" Sidebar Section (Projects with Routines)
**Owner**: Milad
**Started**: 2025-01-18
**Status**: Planning Complete

---

## 🎯 Project Overview

### Goal
Add a new collapsible "Routines" section to the sidebar that displays projects containing routines. Each project entry navigates to a view showing only that project's routines. The section appears between "Projects" and "Priorities" sections, supports sorting (flat list, project order, routine count), and integrates with cmd+k search as "Routines > ProjectName".

### Core Requirements
1. **Section Placement**: Between ProjectsSection and PrioritiesSection
2. **Display**: Only projects that have routines (filtered list)
3. **Navigation**: Click project → view showing that project's routines only
4. **Icon**: Routine icon (Repeat) colored to match project color
5. **Count**: Display active routine count per project
6. **Collapsible**: Persist expand/collapse state to localStorage
7. **Sorting**: Three options (Flat List, Project Order, Routine Count)
8. **Search**: Cmd+k shows "Routines > ProjectName" entries
9. **Dual Views**: Keep existing global "Routines" view in Views section (evaluate later)

### Success Criteria
- ✅ RoutinesSection renders between Projects and Priorities
- ✅ Shows only projects with routines (empty projects excluded)
- ✅ Clicking project navigates to project's routines view
- ✅ Icons use routine icon with project color
- ✅ Active routine counts display correctly
- ✅ Collapse/expand state persists across sessions
- ✅ All three sorting modes work correctly
- ✅ Cmd+k search includes "Routines > ProjectName" entries
- ✅ Validation passes: `bun run typecheck && bun run lint && bun test`

---

## 📋 Implementation Milestones

### **Milestone 1: State Management & Types**
**Goal**: Update sidebar state hook to support routines section collapse and sorting preferences

**Tasks**:
- [ ] Update `app/src/components/layout/Sidebar/hooks/useSidebarState.ts`
  - Add `routines: boolean` to `CollapsedSections` interface
  - Initialize default: `routines: false` (start expanded)
  - Add `routineSort: RoutineSort` state (new type)
  - Add `setRoutineSort` setter function
  - Update localStorage persistence keys

- [ ] Create/Update `app/src/components/layout/Sidebar/types.ts`
  - Add `RoutineSort` type: `"flat" | "projectOrder" | "routineCount"`
  - Add `RoutinesSectionProps` interface
  - Document prop types for new section

**Success Criteria**:
- ✅ `useSidebarState()` returns `collapsed.routines` and `toggleSection("routines")`
- ✅ `routineSort` state persists to localStorage
- ✅ Types compile without errors
- ✅ Typecheck passes: `bun run typecheck`

**Completion Notes**:
```
Date: 2025-01-18
Status: COMPLETED ✅

Notes:
- Added `routines: boolean` to CollapsedSections interface
- Added ROUTINE_SORT to STORAGE_KEYS constant
- Created routineSort state with initialization from localStorage (default: "flat")
- Implemented setRoutineSort callback with localStorage persistence
- Implemented cycleRoutineSort callback for toggling through sort modes
- Exported all new state and functions in return statement

Files Modified (2):
- app/src/components/layout/Sidebar/types.ts
  - Added RoutineSort type: "flat" | "projectOrder" | "routineCount"
  - Added RoutinesSectionProps interface with all required props
  - Updated imports to include ViewSelection and ViewBuildContext
- app/src/components/layout/Sidebar/hooks/useSidebarState.ts
  - Added RoutineSort import
  - Extended CollapsedSections interface with routines field
  - Added ROUTINE_SORT storage key
  - Added routineSort state initialization
  - Added setRoutineSort and cycleRoutineSort callbacks
  - Updated collapsed default to include routines: false
  - Exported routineSort, setRoutineSort, cycleRoutineSort

Test Results:
- ✅ App typecheck: PASSED (zero errors)
- ✅ Types compile correctly
- ✅ All state management functions properly typed

Issues encountered:
- None - straightforward implementation following existing patterns
- Note: Convex typecheck shows pre-existing framework errors (not related to this milestone)

Next steps:
- Milestone 2: Create RoutinesSection component with sorting logic
- Start with RoutinesSection.tsx following TimeSection pattern with LabelsSection sorting
```

---

### **Milestone 2: RoutinesSection Component**
**Goal**: Create the RoutinesSection component that filters and displays projects with routines

**Tasks**:
- [ ] Create `app/src/components/layout/Sidebar/sections/RoutinesSection.tsx`
  - Implement collapsible section (follow TimeSection pattern)
  - Add section header with "Routines" label
  - Add collapse caret toggle
  - Query projects with routines (filter `viewContext.projects` by routine counts)
  - Implement three sorting modes:
    - **Flat List**: Alphabetical by name (flatten hierarchy)
    - **Project Order**: Respect parent-child but flatten (hierarchical traversal, flat display)
    - **Routine Count**: Sort by active routine count (descending)
  - Add sort dropdown menu (similar to ProjectsSection)
  - Map filtered projects to RoutineProjectItem components
  - Handle empty state (no projects with routines)

- [ ] Create `app/src/components/layout/Sidebar/sections/RoutineProjectItem.tsx`
  - Display project name
  - Show routine icon (Repeat) colored to project color
  - Display active routine count badge
  - Click handler navigates to `view:routines:project:{projectId}`
  - Active state when current view matches
  - Hover effects (match ProjectItem pattern)

**Success Criteria**:
- ✅ RoutinesSection renders with collapsible functionality
- ✅ Only projects with routines appear in list
- ✅ All three sorting modes work correctly:
  - Flat: Alphabetical regardless of hierarchy
  - Project Order: Hierarchical order but displayed flat
  - Routine Count: Sorted by count descending
- ✅ Clicking project navigates to project routines view
- ✅ Icons use project colors correctly
- ✅ Active routine counts display accurately
- ✅ Typecheck and lint pass: `bun run typecheck && bun run lint`

**Completion Notes**:
```
Date: 2025-01-18
Status: COMPLETED ✅

Notes:
- Created RoutineProjectItem.tsx with routine icon colored to project color
- Created RoutinesSection.tsx with collapsible functionality and sorting
- Implemented filtering logic using count registry (only projects with active routines)
- Implemented three sorting modes:
  - Flat: Alphabetical by name using localeCompare
  - Project Order: buildProjectTree + flattenProjects (hierarchical order, flat display)
  - Routine Count: Sorted by active routine count descending
- Added sort dropdown with icons (ArrowDownAZ, Network, Hash)
- Handled empty state with "No projects with routines yet" message
- Followed LabelsSection pattern for simplicity and consistency

Files Created (2):
- app/src/components/layout/Sidebar/sections/RoutineProjectItem.tsx (55 lines)
  - Renders individual project with routine icon (Repeat colored to project)
  - Navigates to view:routines:project:{id}
  - Shows active routine count badge
- app/src/components/layout/Sidebar/sections/RoutinesSection.tsx (154 lines)
  - Collapsible section with collapse state persistence
  - Filters projects with routines using count registry
  - Three sorting modes with dropdown
  - Maps filtered/sorted projects to RoutineProjectItem components
  - Empty state handling

Test Results:
- ✅ App typecheck: PASSED (zero errors)
- ✅ Components compile correctly
- ✅ All imports resolve properly
- ✅ Sorting logic uses existing utilities (buildProjectTree, flattenProjects)

Issues encountered:
- None - leveraged existing utilities (buildProjectTree, flattenProjects) for project order sort
- Count registry already supports view:routines:project:{id} pattern
- All patterns followed existing codebase conventions

Next steps:
- Milestone 3: Integrate RoutinesSection into Sidebar.tsx
- Add import and render component between ProjectsSection and PrioritiesSection
- Pass all required props (state from useSidebarState hook)
```

---

### **Milestone 3: Sidebar Integration**
**Goal**: Add RoutinesSection to the main Sidebar component between Projects and Priorities

**Tasks**:
- [ ] Update `app/src/components/layout/Sidebar/Sidebar.tsx`
  - Import `RoutinesSection` component
  - Destructure `routineSort` and `setRoutineSort` from `useSidebarState`
  - Add `<RoutinesSection>` component after ProjectsSection, before PrioritiesSection
  - Pass required props:
    - `currentViewKey`, `onViewChange`, `viewContext` (navigation)
    - `isCollapsed={collapsed.routines}`, `onToggleCollapse={() => toggleSection("routines")}`
    - `sortMode={routineSort}`, `onSortChange={setRoutineSort}`
  - Verify rendering order matches design (Views → Time → Projects → **Routines** → Priorities → Labels)

**Success Criteria**:
- ✅ RoutinesSection renders in correct position (between Projects and Priorities)
- ✅ Section collapses/expands correctly
- ✅ State persists across page refreshes
- ✅ Sorting dropdown updates and persists selection
- ✅ Navigation works correctly
- ✅ No console errors or warnings
- ✅ Typecheck passes: `bun run typecheck`

**Completion Notes**:
```
Date: 2025-01-18
Status: COMPLETED ✅

Notes:
- Imported RoutinesSection component in Sidebar.tsx
- Destructured routineSort and setRoutineSort from useSidebarState hook
- Added RoutinesSection between ProjectsSection and PrioritiesSection (lines 110-118)
- Passed all required props:
  - currentViewKey, onViewChange, viewContext (navigation)
  - isCollapsed={collapsed.routines}, onToggleCollapse (collapse state)
  - sortMode={routineSort}, onSortChange={setRoutineSort} (sorting)
- Fixed lint issues in RoutinesSection.tsx:
  - Removed unused TodoistProjectWithMetadata import
  - Fixed useMemo dependency array (use viewContext instead of viewContext.projectsWithMetadata)

Files Modified (1):
- app/src/components/layout/Sidebar/Sidebar.tsx
  - Added import for RoutinesSection (line 8)
  - Destructured routineSort and setRoutineSort from useSidebarState (lines 42-43)
  - Rendered RoutinesSection component (lines 110-118)

Files Modified (cleanup):
- app/src/components/layout/Sidebar/sections/RoutinesSection.tsx
  - Removed unused import
  - Fixed dependency array warning

Test Results:
- ✅ App typecheck: PASSED (zero errors)
- ✅ RoutinesSection renders in correct position
- ✅ No lint errors for new code
- ✅ All props properly typed and passed

Issues encountered:
- Minor lint warnings fixed:
  - Unused import: TodoistProjectWithMetadata (removed)
  - useMemo dependency: viewContext.projectsWithMetadata redundant (fixed)
- All other lint errors are pre-existing (documented in codebase)

Next steps:
- Milestone 4: Cmd+K search integration
- Add "Routines > ProjectName" entries to command palette
- Update NavHeader.tsx with search items
```

---

### **Milestone 4: Cmd+K Search Integration**
**Goal**: Add "Routines > ProjectName" entries to the command palette search

**Tasks**:
- [ ] Update `app/src/components/layout/Sidebar/components/NavHeader.tsx`
  - Add new search category: "Routines by Project"
  - Filter `viewContext.projectsWithMetadata` to only projects with routines
  - Map to SearchableItem entries:
    - `label`: `project.name`
    - `category`: "Routines" (new category)
    - `path`: "Routines > {projectName}"
    - `viewKey`: `view:routines:project:{projectId}` (needs view key support)
    - `icon`: Routine icon with project color
  - Add to searchable items list
  - Add CommandGroup section for "Routines" category

- [ ] Verify view key support for `view:routines:project:{id}`
  - Check if `app/src/lib/views/viewRegistry.tsx` supports this pattern
  - If not, add dynamic view resolution for routine project views
  - Update ViewKey type if needed

**Success Criteria**:
- ✅ Cmd+K search shows "Routines" category
- ✅ Projects with routines appear as "Routines > ProjectName"
- ✅ Clicking search result navigates to project routines view
- ✅ Icons use project colors correctly
- ✅ Search works with partial matches
- ✅ Empty state if no projects with routines
- ✅ Typecheck passes: `bun run typecheck`

**Completion Notes**:
```
Date:
Status:

Notes:
-

Files Modified:
-

Test Results:
-

Issues encountered:
-

Next steps:
- Milestone 5: Polish & validation
```

---

### **Milestone 5: Polish, Testing & Validation**
**Goal**: Final polish, comprehensive testing, and validation

**Tasks**:
- [ ] **Visual Polish**:
  - Verify icon colors match project colors exactly
  - Check spacing and alignment consistency
  - Ensure hover states work correctly
  - Verify active state styling
  - Test dark mode appearance

- [ ] **Functional Testing**:
  - Create test projects with routines
  - Create projects without routines (should not appear)
  - Test all three sorting modes with various data
  - Test collapse/expand persistence
  - Test navigation to project routine views
  - Test cmd+k search navigation
  - Test with edge cases:
    - Single project with routines
    - Many projects (scrolling)
    - Project names with special characters
    - Projects with 0 active routines but deferred routines

- [ ] **Code Quality**:
  - Run full validation: `bun run typecheck && bun run lint && bun test`
  - Fix any linting warnings
  - Ensure no console errors
  - Review code for consistency with existing patterns
  - Add code comments where needed

- [ ] **Documentation**:
  - Update completion notes for all milestones
  - Document any edge cases discovered
  - Add usage notes if needed

**Success Criteria**:
- ✅ All visual polish items complete
- ✅ All functional tests pass
- ✅ Full validation passes: `bun run typecheck && bun run lint && bun test`
- ✅ No console errors or warnings
- ✅ Code follows existing patterns
- ✅ User can verify all features work

**Completion Notes**:
```
Date:
Status:

Notes:
-

Test Results:
-

Issues encountered:
-

Final notes:
- Ready for user evaluation (keep global Routines view vs remove)
```

---

## 📊 Progress Tracking

**Overall Completion**: 3/5 milestones (60%)

- [x] Planning & Research ✅ (Complete)
- [x] Milestone 1: State Management & Types ✅ (Complete - 2025-01-18)
- [x] Milestone 2: RoutinesSection Component ✅ (Complete - 2025-01-18)
- [x] Milestone 3: Sidebar Integration ✅ (Complete - 2025-01-18)
- [ ] Milestone 4: Cmd+K Search Integration
- [ ] Milestone 5: Polish, Testing & Validation

---

## 🗂️ File Inventory

### Files to Create (2)
- [x] `app/src/components/layout/Sidebar/sections/RoutinesSection.tsx` - Main section component with filtering, sorting, collapsible logic ✅
- [x] `app/src/components/layout/Sidebar/sections/RoutineProjectItem.tsx` - Individual project item with routine icon, color, count ✅

### Files to Modify (4)
- [x] `app/src/components/layout/Sidebar/hooks/useSidebarState.ts` - Add routines collapse state and sort preference ✅
- [x] `app/src/components/layout/Sidebar/types.ts` - Add RoutineSort type and section props ✅
- [x] `app/src/components/layout/Sidebar/Sidebar.tsx` - Import and render RoutinesSection ✅
- [ ] `app/src/components/layout/Sidebar/components/NavHeader.tsx` - Add cmd+k search entries for routines

### Files to Verify (No Changes Expected) - UPDATED: Changes Required
- [x] `app/src/lib/views/viewRegistry.tsx` - Added view key support for `view:routines:project:{id}` ✅
- [x] `app/src/lib/views/types.ts` - Added ViewKey pattern `view:routines:project:${string}` ✅
- [x] `app/src/lib/routing/utils.ts` - Added URL routing for routine project views ✅
- `app/src/lib/views/CountRegistry.ts` - Already supports routine counts ✅
- `app/src/lib/icons/viewIcons.tsx` - Already has Repeat icon ✅
- `convex/todoist/computed/queries/getAllListCounts.ts` - Already computes routine counts ✅

---

## 🔍 Key Technical Decisions

### Decision 1: Section Component Pattern

**Problem**: Which existing sidebar section to use as reference pattern?

**Options Considered**:
1. **ProjectsSection** - Most complex with tree, drag-drop, hierarchy
   - Pros: Full-featured, supports all interactions
   - Cons: Too complex, includes unnecessary features (tree, drag-drop)
2. **LabelsSection** - Dynamic items with sorting
   - Pros: Has sorting dropdown, simpler than projects
   - Cons: Still more complex than needed
3. **TimeSection** - Simplest section with static items
   - Pros: Clean, minimal, easy to understand
   - Cons: No sorting, very basic

**Decision**: Hybrid approach (TimeSection structure + LabelsSection sorting)

**Rationale**:
- TimeSection provides clean collapsible structure
- LabelsSection sorting pattern fits our three sort modes
- No need for tree/hierarchy rendering (flatten all projects)
- No drag-drop needed (routines are read-only in sidebar)
- Simpler = fewer bugs, easier maintenance

**Trade-offs**:
- Won't have hierarchy indentation (acceptable - user requested flat display)
- No drag-to-reorder (not needed for this use case)

**Future Considerations**:
- Could add "Create Routine" quick-action later
- Could add routine completion stats
- Could add color coding by frequency/duration

---

### Decision 2: View Key Pattern for Project Routines

**Problem**: What view key pattern should navigate to a project's routines?

**Evidence from Research**:
- ✅ Global routines: `view:routines` (already exists)
- ✅ Project view: `view:project:{id}` (already includes routines as secondary list)
- ❓ Project routines only: Need to verify if supported

**Options Considered**:
1. **`view:routines:project:{id}`** - Dedicated project routines view
   - Pros: Clean separation, explicit intent
   - Cons: May need new view registry entry
2. **`view:project:{id}` with filter** - Reuse project view, filter to routines
   - Pros: Reuses existing infrastructure
   - Cons: Shows tasks too, not routines-only
3. **Create custom view** - New view type entirely
   - Pros: Full control
   - Cons: Overkill, maintenance overhead

**Decision**: Use `view:routines:project:{id}` pattern

**Rationale**:
- View registry already has `expandRoutinesByProject()` function (line 115-130)
- The `projectRoutinesDefinition` list definition exists (line 347-374)
- Count registry supports `list:routines:${projectId}` pattern
- Clean, explicit, follows existing naming conventions
- May need minor view registry update but infrastructure exists

**Implementation Notes**:
- Check viewRegistry.tsx for dynamic routine project view support
- If missing, add matcher: `key.startsWith("view:routines:project:")`
- Extract projectId from key, pass to `expandRoutinesByProject()`

**Testing**:
- Verify navigation works: Click project → opens routine view
- Verify count matches: Count in sidebar = count in view
- Verify filtering: Only project's routines appear, no others

---

### Decision 3: Sorting Implementation Strategy

**Problem**: How to implement three sorting modes (flat, project order, routine count)?

**Options Considered**:
1. **Client-side sorting** - Sort projects array in component
   - Pros: Simple, no backend changes, instant
   - Cons: Could be slow with many projects
2. **Query-based sorting** - Create Convex queries for each sort
   - Pros: Scalable, consistent with backend patterns
   - Cons: Overkill for sidebar display, more complexity
3. **Hybrid** - Filter in backend, sort in component
   - Pros: Balance of performance and simplicity
   - Cons: Mixing concerns

**Decision**: Client-side sorting in RoutinesSection component

**Rationale**:
- Project list is already loaded in `viewContext.projectsWithMetadata`
- Filtering to projects with routines happens client-side anyway
- Sorting algorithms are simple (alphabetical, hierarchy traversal, numeric)
- Instant feedback on sort change (no query delay)
- Consistent with how LabelsSection handles sorting

**Implementation Details**:

**Flat List Sort** (Alphabetical):
```typescript
const sortedProjects = [...projectsWithRoutines].sort((a, b) =>
  a.name.localeCompare(b.name)
)
```

**Project Order Sort** (Hierarchical, flattened display):
```typescript
// Traverse tree in hierarchical order, collect flat list
function flattenHierarchy(projects: Project[]): Project[] {
  const result: Project[] = []
  const traverse = (project: Project) => {
    result.push(project)
    const children = projects.filter(p => p.parent_id === project.id)
      .sort((a, b) => a.child_order - b.child_order)
    children.forEach(traverse)
  }
  const roots = projects.filter(p => !p.parent_id)
  roots.sort((a, b) => a.child_order - b.child_order)
  roots.forEach(traverse)
  return result
}
```

**Routine Count Sort** (Descending):
```typescript
const sortedProjects = [...projectsWithRoutines].sort((a, b) => {
  const countA = getCountForView(`view:routines:project:${a.id}`, viewContext) ?? 0
  const countB = getCountForView(`view:routines:project:${b.id}`, viewContext) ?? 0
  return countB - countA // Descending
})
```

**Trade-offs**:
- Small performance cost with many projects (acceptable for typical use)
- Simpler code = easier to debug and maintain
- User gets instant sort feedback

---

### Decision 4: Filtering Projects with Routines

**Problem**: How to determine which projects have routines?

**Options Considered**:
1. **Count Registry** - Check if routine count > 0
   - Pros: Uses existing infrastructure, accurate
   - Cons: Couples to count system
2. **Query routines** - Fetch all routines, group by project
   - Pros: Direct data access
   - Cons: Duplicates count query, inefficient
3. **Backend flag** - Add `hasRoutines` field to project metadata
   - Pros: Efficient, explicit
   - Cons: Requires backend changes, adds complexity

**Decision**: Use Count Registry (Option 1)

**Rationale**:
- Count registry already computes routine counts per project
- `getCountForView("view:routines:project:{id}")` returns active routine count
- Zero overhead (data already loaded)
- Accurate (reflects active routines only, excludes deferred)
- Consistent with how other sections determine visibility

**Implementation**:
```typescript
const projectsWithRoutines = viewContext.projectsWithMetadata.filter(project => {
  const routineCount = getCountForView(`view:routines:project:${project.id}`, viewContext)
  return routineCount && routineCount > 0
})
```

**Edge Cases**:
- Project with only deferred routines: Won't appear (correct - we want active only)
- Project with routines deleted: Count updates, project disappears (correct)
- New routine added: Count updates, project appears (correct)

---

## 🚨 Known Edge Cases

### 1. **Projects with Only Deferred Routines**
- **Scenario**: Project has routines but all are deferred (paused)
- **Handling**: Project won't appear in Routines section (count = 0 active)
- **Prevention**: Count registry filters by `defer: false` (active only)
- **Testing**: Create project, add routine, defer it → project should disappear
- **Fallback**: User can see deferred routines in global Routines view or project view

### 2. **Empty Routines Section**
- **Scenario**: No projects have any routines
- **Handling**: Show empty state message: "No projects with routines yet"
- **Prevention**: Check `projectsWithRoutines.length === 0` before rendering
- **Testing**: Fresh database with no routines → should show empty state
- **Fallback**: User can create routines from global Routines view

### 3. **Project Deleted with Active Routines**
- **Scenario**: Project deleted but routines still reference it
- **Handling**: Routines become orphaned (todoistProjectId points to non-existent project)
- **Prevention**: Filter `projectsWithRoutines` by existing projects only
- **Testing**: Delete project via Todoist → routines should move to Inbox or disappear
- **Fallback**: Sync will update routine project assignments

### 4. **Sort Mode Persistence Across Sessions**
- **Scenario**: User changes sort mode, refreshes page
- **Handling**: `routineSort` persists to localStorage via useSidebarState
- **Prevention**: Initialize from localStorage on mount
- **Testing**: Change sort → refresh → verify same sort selected
- **Fallback**: Default to "flat" if localStorage corrupted

### 5. **Project Color Undefined**
- **Scenario**: Project has no color set (null/undefined)
- **Handling**: Use default routine icon color (purple)
- **Prevention**: Check `project.color` before applying, fallback to default
- **Testing**: Create project without color → should show purple icon
- **Fallback**: Default Repeat icon styling

### 6. **Very Long Project Names**
- **Scenario**: Project name exceeds sidebar width
- **Handling**: Truncate with ellipsis, show full name on hover (tooltip)
- **Prevention**: Use CSS `truncate` class on project name
- **Testing**: Create project with 100-char name → should truncate
- **Fallback**: Text wraps if truncate fails (CSS fallback)

### 7. **Rapid Collapse/Expand Clicks**
- **Scenario**: User rapidly clicks collapse caret
- **Handling**: React state batching handles updates smoothly
- **Prevention**: No debounce needed (native browser behavior)
- **Testing**: Click caret 10 times rapidly → should toggle correctly
- **Fallback**: State syncs on next render cycle

### 8. **Cmd+K Search with Duplicate Project Names**
- **Scenario**: Two projects named "Workout" (possible in Todoist)
- **Handling**: Include parent path or ID in search result to differentiate
- **Prevention**: Use unique `viewKey` (includes project ID)
- **Testing**: Create two projects with same name → both appear in search
- **Fallback**: User sees both, clicks navigate to different views

---

## 📝 Notes & Learnings

### Development Notes
```
Research Phase:
- View system already fully configured for routines ✅
- Count registry already computes routine counts per project ✅
- Icons and colors already configured ✅
- Main work: Create UI components and wire up existing systems
- Infrastructure is robust - mostly UI work

Implementation Phase:
- Milestone 1-3: Completed smoothly following existing patterns
- Bug Fix 1: Empty section issue (view key not resolving counts)
- Bug Fix 2: Navigation error (view key not registered)
- Bug Fix 3: URL routing fallback to inbox
```

### Issues Encountered
```
Issue 1: RoutinesSection showing empty
Date: 2025-01-18
Problem: Section displayed no projects even though projects had routines
Root Cause: View key pattern `view:routines:project:{id}` was not registered,
           so getCountForView() couldn't resolve and returned 0 for all projects
Solution: Changed filtering logic to use registry.getAllCounts() directly
         with list count key pattern `list:routines:{projectId}`
Files Modified: app/src/components/layout/Sidebar/sections/RoutinesSection.tsx
Result: Section now correctly displays all projects with routines ✅

Issue 2: Navigation errors when clicking project
Date: 2025-01-18
Problem: Clicking a project threw "Unsupported view key" error
Root Cause: View key pattern `view:routines:project:{id}` not registered in viewRegistry
Solution: Added new view pattern to viewRegistry.tsx that:
         - Matches `view:routines:project:{id}`
         - Extracts projectId
         - Uses expandRoutinesByProject() function
         - Sets metadata with project name and colored icon
         Added ViewKey type pattern to types.ts
Files Modified:
- app/src/lib/views/viewRegistry.tsx (added view pattern lines 450-472)
- app/src/lib/views/types.ts (added ViewKey type line 141)
Result: Navigation works correctly, shows project routines view ✅

Issue 3: URL routing falls back to inbox
Date: 2025-01-18
Problem: Clicking project shows correct view name briefly, then reverts to inbox
         URL also routes to /inbox instead of staying on routines view
Root Cause: URL routing functions (viewKeyToPath, pathToViewKey) didn't support
           the `view:routines:project:{id}` pattern, so it fell back to /inbox
Solution: Added routing support in both directions:
         - viewKeyToPath: `view:routines:project:{id}` → `/routines/projects/{slug}`
         - pathToViewKey: `/routines/projects/{slug}` → `view:routines:project:{id}`
         Uses project slug system for clean URLs (same pattern as regular projects)
Files Modified:
- app/src/lib/routing/utils.ts (added routing patterns lines 26-31, 106-113)
Result: URL routing works correctly, view persists, URLs are clean ✅
```

### Future Enhancements
- [ ] Add routine completion statistics (% complete this week)
- [ ] Color-code by frequency (daily = green, weekly = blue, etc.)
- [ ] Quick-create routine button in section header
- [ ] Drag-to-reorder routines within project
- [ ] Mini calendar showing upcoming routine tasks
- [ ] Filter by frequency (show only daily, weekly, etc.)
- [ ] "Pin" favorite routines to top
- [ ] Show last completion date/time

---

## 🔗 References

**Key Files (Already Implemented)**:
- `/Users/mimen/Programming/Repos/convex-db/app/src/lib/views/viewRegistry.tsx` - View definitions (lines 358-368: routines view)
- `/Users/mimen/Programming/Repos/convex-db/app/src/lib/views/listDefinitions.tsx` - List configs (lines 347-374: project routines)
- `/Users/mimen/Programming/Repos/convex-db/app/src/lib/views/CountRegistry.ts` - Count logic (lines 101-102: routine counts)
- `/Users/mimen/Programming/Repos/convex-db/convex/todoist/computed/queries/getAllListCounts.ts` - Count computation (lines 174-187)

**Similar Patterns (Reference During Implementation)**:
- `/Users/mimen/Programming/Repos/convex-db/app/src/components/layout/Sidebar/sections/TimeSection.tsx` - Simple collapsible section
- `/Users/mimen/Programming/Repos/convex-db/app/src/components/layout/Sidebar/sections/LabelsSection.tsx` - Sorting dropdown pattern
- `/Users/mimen/Programming/Repos/convex-db/app/src/components/layout/Sidebar/sections/ProjectsSection.tsx` - Complex reference (tree, drag-drop)

**Component Patterns**:
- `/Users/mimen/Programming/Repos/convex-db/app/src/components/layout/Sidebar/components/SidebarButton.tsx` - Item rendering
- `/Users/mimen/Programming/Repos/convex-db/app/src/components/layout/Sidebar/components/CollapseCaret.tsx` - Collapse toggle
- `/Users/mimen/Programming/Repos/convex-db/app/src/components/layout/Sidebar/components/CountBadge.tsx` - Count display

**Commands**:
```bash
# Development
bunx convex dev
cd app && bun run dev

# Validation (REQUIRED before commits)
bun run typecheck && bun run lint && bun test

# Testing routines
bunx convex run routines:queries.getRoutines
bunx convex run routines:queries.getRoutinesByProject '{"projectId": "xxx"}'
bunx convex run todoist:computed.queries.getAllListCounts

# Create test data
bunx convex run routines:actions.createRoutine '{"name": "Test", "todoistProjectId": "xxx"}'
```

**Architecture Diagram**:
```
User clicks project in Routines section
  ↓
RoutineProjectItem.onClick()
  ↓
onViewChange(resolveView("view:routines:project:{id}", viewContext))
  ↓
App navigates to project routines view
  ↓
RoutinesListView renders with ListQueryInput: { type: "routines", projectId }
  ↓
Query: getRoutinesByProject({ projectId })
  ↓
Renders RoutineListItem components (active routines only)
```

---

**Last Updated**: 2025-01-18 (Planning complete, ready for implementation)
