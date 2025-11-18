# Sort & Group Feature - BaseListView Enhancement

**Project**: Configurable Sort and Group for BaseListView with Persistent Settings
**Owner**: Milad
**Started**: 2025-01-18
**Status**: Milestone 1 Complete

---

## 🎯 Project Overview

### Goal
Add configurable sorting and grouping to BaseListView with persistent localStorage settings, allowing users to organize tasks/projects/routines by different criteria (A-Z, priority, project, duration, etc.) and collapse groups as needed.

### Core Architecture

**Data Flow**:
1. Parent view (TaskListView, ProjectsListView, etc.) defines available sort/group options
2. `useListViewSettings` hook loads saved preferences from localStorage (per list ID)
3. Parent applies sorting/grouping to entities array before passing to BaseListView
4. BaseListView renders grouped data with collapsible headers
5. Settings dropdown in header allows changing sort/group modes
6. `groupData` prop provides lookup tables (projects, labels) for group labels

**Key Insight**: BaseListView stays simple—parent handles transformation. Sort/group are presentation concerns, not data concerns.

### Success Criteria
- [ ] Users can sort lists by multiple criteria (A-Z, priority, date, etc.)
- [ ] Users can group lists by category (project, priority, label, duration)
- [ ] Group headers are collapsible with icon indicating expanded/collapsed state
- [ ] Sort/group preferences persist in localStorage per list ID
- [ ] Focus navigation works correctly with sorted/grouped data
- [ ] Empty groups are hidden, global empty state shown when no entities
- [ ] All validation passes: `bun run typecheck && bun run lint && bun test`
- [ ] Dropdown UI fits naturally in list header or collapses to menu

---

## 📋 Implementation Milestones

### **Milestone 1: Core Types, Utilities & Hooks** ✅ COMPLETED

**Goal**: Define types and create foundational utilities for sorting/grouping system

**Completion Notes**:
```
Date: 2025-01-18
Status: COMPLETED ✅

Notes:
- Created SortOption<T> and GroupOption<T> types with proper generics
- Implemented sortAndGroup.ts with applyGrouping, applySorting, combined function
- Built useListViewSettings hook following useSidebarState pattern (safe localStorage)
- Extended BaseListViewProps interface with sort/group optional props
- All code uses strict TypeScript, no `any` types

Files Created (2):
- app/src/lib/views/sortAndGroup.ts (84 lines) - Sorting/grouping utility functions
- app/src/hooks/list-items/useListViewSettings.ts (101 lines) - localStorage hook

Files Modified (2):
- app/src/lib/views/types.ts - Added SortOption, GroupOption, ListViewSettings types
- app/src/components/list-items/BaseListView.tsx - Extended props with sort/group options

Issues encountered:
- None - straightforward implementation following existing patterns

Test Results:
- ✅ TypeScript: App compiles with zero errors
- ✅ All imports resolve correctly
- ✅ Types are properly exported and available

Next steps:
- Milestone 2: Create UI components (CollapsibleGroupHeader, dropdown menu)
- Pattern: Follow existing Sidebar component style for dropdowns
```

---

### **Milestone 2: UI Components**
**Goal**: Create reusable UI components for sort/group controls and group headers

**Tasks**:
- [ ] Create `app/src/components/ui/CollapsibleGroupHeader.tsx`
  - Props: groupKey, label, count, isCollapsed, onToggle
  - Shows: icon (chevron up/down), group label, entity count, clickable to toggle
  - Styling: subtle background, rounded, space-y-1 layout
  - Accessibility: button semantics, aria-expanded

- [ ] Create or extend dropdown components for sort/group menus
  - Can reuse/extend existing `SortDropdown.tsx` pattern
  - Generic dropdown accepting options array
  - Checkmark shows current selection
  - Separators between sort and group sections

- [ ] Create `app/src/components/ViewSettingsDropdown.tsx` (optional)
  - Combines sort + group options in single menu
  - Sort section, separator, group section (None + all options)
  - Flexible to adapt to space constraints

**Success Criteria**:
- ✅ CollapsibleGroupHeader renders and toggles with click
- ✅ Dropdown menu shows sort/group options with current selection checked
- ✅ Components match existing design system (spacing, colors, typography)
- ✅ Typecheck passes: `bun run typecheck`

---

### **Milestone 3: BaseListView Integration**
**Goal**: Extend BaseListView to render sorted/grouped data with settings controls

**Tasks**:
- [ ] Call `useListViewSettings(list.id, defaultSort, defaultGroup)` inside BaseListView
- [ ] Use `useMemo` to compute `processedData` (apply grouping first, then sorting within groups)
- [ ] Filter out empty groups
- [ ] Update entity refs array to exclude entities in collapsed groups (for focus management)
- [ ] Render settings dropdown in header (next to count badge)
- [ ] Implement grouped rendering path with CollapsibleGroupHeader
- [ ] Keep flat rendering path for non-grouped data

**Success Criteria**:
- ✅ BaseListView renders both flat and grouped data correctly
- ✅ Dropdown controls appear in header, sort/group changes work
- ✅ Group collapse/expand works, state persists in localStorage
- ✅ Focus navigation works with grouped data (j/k keys navigate visible entities only)
- ✅ Empty list state shows globally (hides when has entities)
- ✅ Typecheck passes: `bun run typecheck`

---

### **Milestone 4: Entity Configuration Files**
**Goal**: Define sort/group options for each entity type (Task, Project, Routine)

**Tasks**:
- [ ] Create `app/src/lib/views/entityConfigs/taskConfig.ts`
  - taskSortOptions: A-Z, Priority, Due Date
  - taskGroupOptions: Project, Priority, Label

- [ ] Create `app/src/lib/views/entityConfigs/projectConfig.ts`
  - projectSortOptions: A-Z, Priority, TaskCount, Color
  - projectGroupOptions: Parent Project

- [ ] Create `app/src/lib/views/entityConfigs/routineConfig.ts`
  - routineSortOptions: A-Z, Frequency, Duration
  - routineGroupOptions: Duration, Frequency, Project

**Success Criteria**:
- ✅ All config files compile without errors
- ✅ Functions handle null/undefined values gracefully
- ✅ Typecheck passes: `bun run typecheck`

---

### **Milestone 5: List View Integration & Testing**
**Goal**: Update individual list views to pass sort/group options to BaseListView and verify functionality

**Tasks**:
- [ ] Update `app/src/components/TaskListView.tsx`
- [ ] Update `app/src/components/ProjectsListView.tsx`
- [ ] Update `app/src/components/RoutinesListView.tsx`
- [ ] Manual testing with real data via Todoist MCP

**Success Criteria**:
- ✅ All list views render with sort/group options
- ✅ localStorage correctly persists settings per list ID
- ✅ Typecheck & lint passes
- ✅ User can test all features manually

---

## 📊 Progress Tracking

**Overall Completion**: 1/5 milestones (20%)

- [x] Planning & Research
- [x] Milestone 1: Core Types, Utilities & Hooks
- [ ] Milestone 2: UI Components
- [ ] Milestone 3: BaseListView Integration
- [ ] Milestone 4: Entity Configuration Files
- [ ] Milestone 5: List View Integration & Testing

---

## 🗂️ File Inventory

### Files Created (2)
- [x] `app/src/lib/views/sortAndGroup.ts` - Sorting/grouping utility functions
- [x] `app/src/hooks/list-items/useListViewSettings.ts` - localStorage hook

### Files to Create (9)
- [ ] `app/src/components/ui/CollapsibleGroupHeader.tsx` - Group header component
- [ ] `app/src/components/ViewSettingsDropdown.tsx` - Sort/group menu dropdown
- [ ] `app/src/lib/views/entityConfigs/taskConfig.ts` - Task sort/group options
- [ ] `app/src/lib/views/entityConfigs/projectConfig.ts` - Project sort/group options
- [ ] `app/src/lib/views/entityConfigs/routineConfig.ts` - Routine sort/group options
- [ ] `app/src/hooks/list-items/useListViewSettings.test.ts` - Settings hook tests
- [ ] `app/src/lib/views/sortAndGroup.test.ts` - Sorting/grouping tests

### Files Modified (2)
- [x] `app/src/lib/views/types.ts` - Added sort/group types
- [x] `app/src/components/list-items/BaseListView.tsx` - Extended props

### Files to Modify (3)
- [ ] `app/src/components/TaskListView.tsx` - Pass sort/group options
- [ ] `app/src/components/ProjectsListView.tsx` - Pass sort/group options
- [ ] `app/src/components/RoutinesListView.tsx` - Pass sort/group options

---

## 🔍 Key Technical Decisions

### Decision 1: Where Should Sort/Group Logic Live?

**Problem**: Should sort/group logic be in BaseListView (generic) or in parent views (entity-specific)?

**Decision**: Hybrid approach - Parent applies transformation, BaseListView just renders

**Rationale**:
- Parent views already know about their entity type and available options
- BaseListView stays generic and simple (just renders what it's given)
- Sorting/grouping is a presentation concern, not a data concern
- Pattern aligns with existing design: parent filters, BaseListView displays

---

### Decision 2: Data Lookups for Group Labels

**Problem**: Group labels need to convert group keys (e.g., project ID) to display names

**Decision**: Pass data objects as groupData prop (Option 3)

**Rationale**:
- Parent already fetches projects, labels, etc. for rendering
- No additional fetches needed
- Allows groupConfig functions to be simple and pure
- No memoization required (data just passed through)
- Cleanest API: `groupData={{ projects, labels }}`

---

### Decision 3: Focus Management with Grouped Data

**Problem**: When entities are grouped/sorted, focused index may point to wrong entity

**Decision**: Store focused entity ID in FocusContext, index computed from array

**Rationale**:
- Already implemented for FocusContext (stores entity, not index)
- BaseListView computes index from entities array (works with any ordering)
- Focus automatically "follows" entity even if re-sorted

---

### Decision 4: localStorage Key Format

**Problem**: Multiple views need independent sort/group settings

**Decision**: Per-list ID - `list-settings:{list.id}`

**Rationale**:
- Multi-list views (project + routines) benefit from independent settings
- User might want different sort for tasks vs. routines on same project
- Matches existing sidebar pattern (each section independent)

---

## 🚨 Known Edge Cases

1. **Empty Groups** - View has data but all entities in one group
   - Handling: Show single group with all entities
   - Testing: Create tasks all in same project, group by project

2. **Null/Undefined Group Keys** - Entity has no value for grouping criteria
   - Handling: Group under "Inbox" or generic label
   - Testing: Create task with no project, group by project

3. **Group Label Lookup Missing** - Project/label doesn't exist in groupData
   - Handling: groupLabel falls back to "Unknown"
   - Testing: Delete project, task still references old ID, group by project

4. **Focused Entity in Collapsed Group** - User collapses group containing focused entity
   - Handling: Focus persists, but not visible (j/k skip collapsed)
   - Testing: Focus task, collapse its group, press j

5. **localStorage Corruption** - Corrupted JSON in localStorage
   - Handling: Safe getter catches error, returns default
   - Testing: Manually set corrupted JSON in DevTools, reload

6. **Sort Stability** - Multiple entities with same sort key
   - Handling: Sort is stable (maintains insertion order for ties)
   - Testing: Create 3 tasks same priority, sort by priority, verify order stable

---

## 🔗 References

**Key Files Studied**:
- `app/src/components/layout/Sidebar/hooks/useSidebarState.ts` - localStorage pattern
- `app/src/components/list-items/BaseListView.tsx` - Component structure
- `app/src/components/layout/Sidebar/components/SortDropdown.tsx` - Dropdown UI pattern

**Commands**:
```bash
# Development
bunx convex dev

# Validation (REQUIRED before each commit)
bun run typecheck && bun run lint && bun test
```

---

**Last Updated**: 2025-01-18 (Milestone 1 complete, ready for Milestone 2)
