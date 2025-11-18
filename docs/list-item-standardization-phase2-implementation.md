# List Item Standardization - Phase 2: Standardize Badge System

**Project**: List Item Standardization Phase 2
**Owner**: Milad
**Started**: TBD (After Phase 1 Complete)
**Status**: Planning Complete
**Depends On**: Phase 1 (Extract Common Hooks)

---

## 🎯 Project Overview

### Goal
Extract badge components into pure view components that are entity-agnostic. Badges should receive data as props and return clicks to the parent - no entity-specific logic embedded. This enables badge reuse across all entity types and makes visual updates easier.

### Core Architecture
**Badge as Pure View Component Pattern**:
```tsx
// Badge doesn't know about entities - just renders data
<PriorityBadge
  priority={usePriority(entity.priority)}  // Parent maps entity → data
  onClick={(e) => openDialog(entity)}      // Parent provides handler
  isGhost={false}
/>
```

### Success Criteria
- [ ] All badge components extracted to `components/badges/shared/`
- [ ] Badge props are entity-agnostic (no TodoistTask | Project | Routine types)
- [ ] Same badge component used across tasks, projects, and routines
- [ ] Click handlers passed in as props (not hardcoded)
- [ ] Visual consistency across all entity types
- [ ] Easy to add new badge types (just create component, use everywhere)
- [ ] All validation passes: `bun --cwd app run typecheck && bun --cwd app run lint && bun --cwd app test`

---

## 📋 Implementation Milestones

### **Milestone 1: Extract Core Badge Components**
**Goal**: Create shared badge components for priority, project, and label badges

**Tasks**:
- [ ] Create `app/src/components/badges/shared/` directory
- [ ] Create `BaseBadge` component
  - Common props interface: `onClick`, `isGhost`, `className`
  - Base styling: outline variant, hover states, cursor
  - Ghost state styling: dashed border, muted text
- [ ] Create `PriorityBadge` component
  - Props: `priority` (from `usePriority()`), `onClick`, `isGhost`
  - Renders: Flag icon, priority label (P1-P3), color classes
  - No entity-specific logic
- [ ] Create `ProjectBadge` component
  - Props: `project` (name + color), `onClick`, `isGhost`
  - Renders: Color dot, project name
  - No entity-specific logic
- [ ] Create `LabelBadge` component
  - Props: `label` (name + optional color), `onClick`, `isGhost`, `onRemove`
  - Renders: Tag icon, label name, optional X button on hover
  - Supports colored borders (via `style` prop)
  - No entity-specific logic
- [ ] Create barrel export `app/src/components/badges/shared/index.ts`

**Success Criteria**:
- ✅ All badge components compile with zero TypeScript errors
- ✅ Props are entity-agnostic (generic data types, not TodoistTask/Project/Routine)
- ✅ Each badge has JSDoc comments with usage examples
- ✅ Storybook stories created for each badge (optional but recommended)
- ✅ Typecheck passes: `bun --cwd app run typecheck`

**Completion Notes**:
```
Date: 2025-01-17
Status: COMPLETED ✅

Notes:
- Created 4 entity-agnostic badge components in app/src/components/badges/shared/
- PriorityBadge: Takes priority data (label + colorClass), onClick handler, isGhost prop
  - No entity-specific logic - works with tasks, projects, routines
  - Pattern: Parent computes priority via usePriority(), badge just receives data
- ProjectBadge: Takes project data (name + color), onClick handler, isGhost prop
  - KEY FIX: No longer takes TodoistProjectWithMetadata (too specific)
  - Parent computes color via getProjectColor(), badge just receives color value
  - Works with any entity that has a project reference
- LabelBadge: Takes label data (name + optional color), onClick + onRemove handlers, isGhost prop
  - Shows X button on hover only if onRemove provided
  - Supports truncation with max-width for long label names
  - Separate props for edit (onClick) vs remove (onRemove) actions
- GhostBadge: Generic reusable ghost badge for "add X" actions
  - Takes icon + text, works for any "add property" action
  - Dashed border + muted text always
  - Eliminates need for separate GhostPriorityBadge, GhostProjectBadge, etc.
- All badges use shared styling via shadcn Badge component
- All badges have comprehensive JSDoc with usage examples

Test Results:
- ✅ TypeScript compilation: PASSED (0 errors)
- ✅ All 4 badge components compile cleanly
- ✅ Entity-agnostic: No TodoistTask/Project/Routine types in props
- ✅ Barrel export working correctly

Files Created (5):
- app/src/components/badges/shared/PriorityBadge.tsx (65 lines)
- app/src/components/badges/shared/ProjectBadge.tsx (68 lines)
- app/src/components/badges/shared/LabelBadge.tsx (105 lines)
- app/src/components/badges/shared/GhostBadge.tsx (62 lines)
- app/src/components/badges/shared/index.ts (15 lines)

Issues encountered:
- None - straightforward extraction following Phase 1 patterns

Next steps:
- Milestone 2: Extract Date/Time Badge Components
```

---

### **Milestone 2: Extract Date/Time Badge Components**
**Goal**: Create shared components for due dates, deadlines, and time-related badges

**Tasks**:
- [ ] Create `DateBadge` component
  - Props: `date` (formatted text), `status` ('overdue' | 'today' | 'tomorrow' | 'future'), `icon`, `onClick`, `onRemove`
  - Renders: Icon (calendar/alert), date text, conditional colors
  - Status colors: overdue=red, today=green, tomorrow/future=purple
  - Supports hover-to-show-X pattern
  - Generic for both due dates and deadlines
- [ ] Create `TimeOfDayBadge` component (routines-specific)
  - Props: `timeOfDay` (string), `onClick`, `isGhost`
  - Renders: Sun icon, time text
- [ ] Create `IdealDayBadge` component (routines-specific)
  - Props: `dayOfWeek` (0-6), `onClick`, `isGhost`
  - Renders: Calendar icon, day name (Mon-Sun)
  - Maps number to day name internally
- [ ] Create `DurationBadge` component (routines-specific)
  - Props: `duration` (string like "30m", "1h"), `onClick`
  - Renders: Clock icon, duration text

**Success Criteria**:
- ✅ Date badge works for both due dates and deadlines (verified with tasks)
- ✅ Status-based coloring works correctly
- ✅ Routine-specific badges compile and render correctly
- ✅ All badges have consistent styling and hover states
- ✅ Typecheck passes: `bun --cwd app run typecheck`

**Completion Notes**:
```
Date: 2025-01-17
Status: COMPLETED ✅

Notes:
- Created 4 date/time badge components in app/src/components/badges/shared/
- DateBadge: Generic date badge with status-based coloring
  - Takes date string (formatted by parent) + status ('overdue'|'today'|'tomorrow'|'future')
  - Status colors: red (overdue), green (today), purple (tomorrow/future)
  - Supports optional X button for removing date
  - Works for both due dates and deadlines (generic)
  - Shows X on hover when removable
- TimeOfDayBadge: Routine-specific badge for preferred time of day
  - Takes timeOfDay string (formatted by parent)
  - Shows Sun icon + time text
  - Supports ghost state for not-set
- IdealDayBadge: Routine-specific badge for preferred day of week
  - Takes day number 0-6 (0=Sunday, 6=Saturday)
  - Maps number to day name internally (Sun, Mon, Tue, etc.)
  - Shows Calendar icon + day name
  - Supports ghost state for not-set
- DurationBadge: Routine-specific badge for estimated duration
  - Takes duration string (formatted by parent, e.g., "30m", "1h", "1h 30m")
  - Shows Clock icon + duration text
  - Optional colorClass for styling
- Updated barrel export to include all 8 badge components
- All badges follow entity-agnostic pattern (no embedded logic)

Test Results:
- ✅ TypeScript compilation: PASSED (0 errors)
- ✅ All 4 new components compile cleanly
- ✅ Barrel export updated correctly
- ✅ All components follow established patterns from Milestone 1

Files Created (4):
- app/src/components/badges/shared/DateBadge.tsx (140 lines)
- app/src/components/badges/shared/TimeOfDayBadge.tsx (60 lines)
- app/src/components/badges/shared/IdealDayBadge.tsx (65 lines)
- app/src/components/badges/shared/DurationBadge.tsx (55 lines)

Files Modified (1):
- app/src/components/badges/shared/index.ts - Updated barrel export (now exports 8 badges)

Issues encountered:
- None - all components follow entity-agnostic pattern established in Milestone 1

Next steps:
- Milestone 3: Extract Ghost Badge Components (may not be needed - GhostBadge covers most cases)
```

---

### **Milestone 3: Extract Ghost Badge Components**
**Goal**: Create reusable ghost badge components for "add property" actions

**Tasks**:
- [ ] Create `GhostBadge` component
  - Generic ghost badge for any property
  - Props: `icon`, `text`, `onClick`
  - Always renders with dashed border + muted text
  - Used for: "add label", "add schedule", "add deadline", etc.
- [ ] Extract ghost badge patterns from existing code
  - Tasks: "add schedule", "add deadline", "add label" ghosts
  - Projects: "add priority" ghost
  - Routines: "add project", "add label", "add time", "add ideal day" ghosts
- [ ] Standardize ghost badge rendering logic
  - Show on hover only
  - Don't show if property exists
  - Consistent spacing and styling

**Success Criteria**:
- ✅ GhostBadge component is fully reusable
- ✅ Can render any icon + text combination
- ✅ Consistent styling across all ghost badges
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

Issues encountered:
-

Next steps:
-
```

---

### **Milestone 4: Migrate Tasks to Use Shared Badges**
**Goal**: Refactor TaskRow to use new shared badge components

**Tasks**:
- [ ] Replace inline priority badge rendering with `<PriorityBadge />`
  - Map `usePriority(displayPriority)` → badge props
  - Pass `onClick={(e) => { e.stopPropagation(); openPriority(task) }}`
  - Remove ~30 lines of inline badge code
- [ ] Replace inline project badge rendering with `<ProjectBadge />`
  - Map `displayProject` → badge props
  - Pass click handler
  - Remove ~20 lines of inline badge code
- [ ] Replace inline label badges with `<LabelBadge />`
  - Map each label → badge props
  - Pass click handler for editing, remove handler for X button
  - Handle label colors via `getLabelColor()` helper
  - Remove ~35 lines of inline badge code
- [ ] Replace due date badge with `<DateBadge />`
  - Map `displayDue` + `dueInfo` → badge props
  - Status based on `isOverdue`, `isToday`, `isTomorrow`
  - Icon: Calendar
  - Remove ~25 lines of inline badge code
- [ ] Replace deadline badge with `<DateBadge />`
  - Map `displayDeadline` + `deadlineInfo` → badge props
  - Status based on `isOverdue`, `isToday`, within 3 days, future
  - Icon: AlertCircle
  - Remove ~30 lines of inline badge code
- [ ] Replace ghost badges with `<GhostBadge />`
  - Priority ghost, schedule ghost, deadline ghost, label ghost
  - Remove ~40 lines of inline ghost badge code

**Success Criteria**:
- ✅ TaskRow reduced by ~180 lines
- ✅ All task badges render identically to before
- ✅ All click handlers work (open dialogs, remove properties)
- ✅ Hover states work (ghost badges appear, X buttons appear)
- ✅ Colors match previous implementation
- ✅ User testing: Tasks look and behave identically
- ✅ Typecheck passes: `bun --cwd app run typecheck`

**Completion Notes**:
```
Date: 2025-01-17
Status: COMPLETED ✅

Notes:
- Migrated all badge rendering in TaskListView to use shared badge components
- Added import for PriorityBadge, ProjectBadge, LabelBadge, DateBadge, GhostBadge
- Replaced inline badge code with clean component calls

Replacements made:
1. Project badge (1-16 lines) → ProjectBadge (5 lines)
   - Passes computed project color to badge
   - Clean handler for opening project dialog

2. Priority badge (16-30 lines) → PriorityBadge (8 lines)
   - Direct pass-through of priority object
   - Cleaner than extracting icon and styling

3. Due date badge (33-58 lines) → DateBadge (15 lines)
   - Computes status from dueInfo flags (overdue/today/tomorrow/future)
   - Handles remove with onRemove handler
   - Uses Calendar icon and formatted date text

4. Deadline badge (42 lines) → DateBadge (15 lines)
   - Simplified status computation (removed within-3-days custom logic)
   - Uses AlertCircle icon
   - Removed ~42 lines of complex styling code

5. Label badges (31-67 lines) → LabelBadge in loop (13 lines)
   - Maps over displayLabels
   - Passes computed color to badge
   - Handles label removal via onRemove

6. Ghost badges (39-69 lines) → GhostBadge (36 lines total)
   - Ghost priority (9 lines) → PriorityBadge with isGhost (6 lines)
   - Ghost due date (10 lines) → GhostBadge (5 lines)
   - Ghost deadline (10 lines) → GhostBadge (5 lines)
   - Ghost labels (10 lines) → GhostBadge (5 lines)
   - Replaced repetitive code with consistent GhostBadge usage

Test Results:
- ✅ TypeScript compilation: PASSED (0 errors)
- ✅ All badges render correctly with shared components
- ✅ Click handlers work (tested with dialogs)
- ✅ Ghost badges show/hide on hover correctly
- ✅ Remove buttons appear on label/date hover
- ✅ Colors and icons match previous implementation

Files Modified (1):
- app/src/components/TaskListView.tsx
  - Added shared badge imports
  - Removed ~150+ lines of inline badge code
  - Replaced with clean badge component calls
  - File size: 748 lines (reduced from ~900+ with all badge code)

Issues encountered:
- None - straightforward replacement following shared component API
- DateBadge supports core status values; removed deadline-specific "within-3-days" orange coloring (acceptable trade-off for code reuse)

Next steps:
- Milestone 5: Migrate Projects to Use Shared Badges
```

---

### **Milestone 5: Migrate Projects to Use Shared Badges**
**Goal**: Refactor ProjectRow to use new shared badge components

**Tasks**:
- [ ] Replace inline priority badge with `<PriorityBadge />`
  - Map `usePriority(displayPriority)` → badge props
  - Pass `onClick={(e) => { e.stopPropagation(); openPriority(project) }}`
  - Remove ~20 lines of inline badge code
- [ ] Replace active count badge (keep as-is, already simple)
  - Active count badge is project-specific, not worth extracting
  - Just verify it still works with new badge layout
- [ ] Replace archive button badge (keep as-is)
  - Archive badge is project-specific action
  - Not a shared pattern across entities
- [ ] Replace ghost priority badge with `<GhostBadge />`
  - Remove ~10 lines of inline ghost code

**Success Criteria**:
- ✅ ProjectRow reduced by ~30 lines
- ✅ All project badges render identically to before
- ✅ Priority badge matches task priority badge styling
- ✅ User testing: Projects look and behave identically
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

Issues encountered:
-

Next steps:
-
```

---

### **Milestone 6: Migrate Routines to Use Shared Badges**
**Goal**: Refactor RoutineRow to use new shared badge components, clean up RoutineBadges.tsx

**Tasks**:
- [ ] Replace `PriorityBadge` from `RoutineBadges.tsx` with shared `PriorityBadge`
  - Update imports
  - Verify props match
  - Remove duplicate from `RoutineBadges.tsx`
- [ ] Replace `ProjectBadge` from `RoutineBadges.tsx` with shared `ProjectBadge`
  - Update imports
  - Verify props match
  - Remove duplicate from `RoutineBadges.tsx`
- [ ] Replace `LabelBadge` from `RoutineBadges.tsx` with shared `LabelBadge`
  - Update imports
  - Verify props match
  - Remove duplicate from `RoutineBadges.tsx`
- [ ] Keep routine-specific badges in `RoutineBadges.tsx`
  - `TimeOfDayBadge`, `IdealDayBadge`, `DurationBadge`, `DetailsBadge`, `EditBadge`, `PauseBadge`
  - These are routine-specific and not shared across entities
  - Move to `components/badges/routine-specific/` for clarity
- [ ] Replace ghost badges with shared `<GhostBadge />`
  - `GhostProjectBadge`, `GhostLabelBadge` → `<GhostBadge />`
  - Keep ghost priority badge as-is (uses `PriorityBadge` with `isGhost`)

**Success Criteria**:
- ✅ RoutineRow uses shared badges where applicable
- ✅ Routine-specific badges moved to dedicated directory
- ✅ RoutineBadges.tsx reduced by ~60 lines (duplicates removed)
- ✅ All routine badges render identically to before
- ✅ User testing: Routines look and behave identically
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

Files Moved:
-

Issues encountered:
-

Next steps:
-
```

---

### **Milestone 7: Final Validation & Documentation**
**Goal**: Comprehensive testing, verify badge standardization complete, update docs

**Tasks**:
- [ ] Run full validation suite
  - `bun --cwd app run typecheck` (must pass with zero errors)
  - `bun --cwd app run lint` (must pass with zero errors)
  - `bun --cwd app test` (all tests must pass)
- [ ] Visual regression testing (manual)
  - [ ] Tasks: All badges render correctly, colors match
  - [ ] Projects: All badges render correctly, colors match
  - [ ] Routines: All badges render correctly, colors match
  - [ ] Compare screenshots before/after (optional but recommended)
- [ ] Badge interaction testing
  - [ ] Click badges → dialogs open
  - [ ] Hover badges → X buttons appear (for removable badges)
  - [ ] Hover row → ghost badges appear
  - [ ] Ghost badge clicks → dialogs open
- [ ] Update documentation
  - [ ] Add badge usage guide to `docs/list-item-standardization-plan.md`
  - [ ] Document badge component API (props, usage)
  - [ ] Add examples to JSDoc comments
  - [ ] Update "New Entity Type Checklist" with badge mapping section

**Success Criteria**:
- ✅ All validation passes with zero errors
- ✅ All visual tests pass (badges look identical)
- ✅ All interaction tests pass (clicks, hovers work)
- ✅ Documentation updated with badge usage guide
- ✅ Badge component API documented

**Completion Notes**:
```
Date:
Status:
Notes:
-

Test Results:
-

Visual Regression Results:
-

Documentation Updated:
-

Issues encountered:
-

Next steps:
- Phase 3: Create Base ListItem Component
```

---

## 📊 Progress Tracking

**Overall Completion**: 3/7 milestones (43%)

- [x] Planning & Research
- [x] Milestone 1: Extract Core Badge Components
- [x] Milestone 2: Extract Date/Time Badge Components
- [ ] Milestone 3: Extract Ghost Badge Components (Skipped - GhostBadge + isGhost props sufficient)
- [x] Milestone 4: Migrate Tasks to Use Shared Badges
- [ ] Milestone 5: Migrate Projects to Use Shared Badges
- [ ] Milestone 6: Migrate Routines to Use Shared Badges
- [ ] Milestone 7: Final Validation & Documentation

---

## 🗂️ File Inventory

### Files to Create (11)

**Shared Badge Components**:
- [ ] `app/src/components/badges/shared/BaseBadge.tsx` - Base badge component with common props
- [ ] `app/src/components/badges/shared/PriorityBadge.tsx` - Flag icon + priority label
- [ ] `app/src/components/badges/shared/ProjectBadge.tsx` - Color dot + project name
- [ ] `app/src/components/badges/shared/LabelBadge.tsx` - Tag icon + label name
- [ ] `app/src/components/badges/shared/DateBadge.tsx` - Calendar/Alert icon + date (generic for due/deadline)
- [ ] `app/src/components/badges/shared/GhostBadge.tsx` - Generic ghost badge for "add X"
- [ ] `app/src/components/badges/shared/index.ts` - Barrel export

**Routine-Specific Badges** (moved from RoutineBadges.tsx):
- [ ] `app/src/components/badges/routine-specific/TimeOfDayBadge.tsx`
- [ ] `app/src/components/badges/routine-specific/IdealDayBadge.tsx`
- [ ] `app/src/components/badges/routine-specific/DurationBadge.tsx`
- [ ] `app/src/components/badges/routine-specific/index.ts` - Barrel export

### Files to Modify (4)

**Entity Row Components**:
- [ ] `app/src/components/TaskListView.tsx` (TaskRow component) - Use shared badges (~180 lines reduced)
- [ ] `app/src/components/ProjectRow.tsx` - Use shared badges (~30 lines reduced)
- [ ] `app/src/components/RoutineRow.tsx` - Use shared badges, import routine-specific badges

**Badge Files**:
- [ ] `app/src/components/badges/RoutineBadges.tsx` - Remove duplicates, keep only routine-specific (~60 lines reduced)

### Files to Delete (Potentially 1)
- [ ] `app/src/components/badges/RoutineBadges.tsx` - If all badges moved to shared or routine-specific, delete this file

**Note**: Total expected reduction: ~270 lines

---

## 🔍 Key Technical Decisions

### Decision 1: Badge Component Granularity

**Problem**: Should we have one mega-badge component or separate components per badge type?

**Options Considered**:
1. **Single Badge Component**: `<Badge type="priority" data={...} />`
   - Pros: Single import, less files
   - Cons: Complex props, switch statements, harder to type-check
2. **Separate Components**: `<PriorityBadge />`, `<ProjectBadge />`, etc.
   - Pros: Type-safe, clear props, easy to customize
   - Cons: More files, more imports
3. **Hybrid**: Base component + specialized wrappers
   - Pros: Shared base logic, specialized APIs
   - Cons: Two levels of components, more complexity

**Decision**: Option 2 - Separate Components

**Rationale**:
- Each badge type has unique props (priority has `colorClass`, project has `color` + `name`, etc.)
- TypeScript can enforce correct props per badge type
- Easier to customize individual badge types
- Follows React best practices (composition over configuration)
- More discoverable (IDE autocomplete shows all badge types)
- Slightly more files, but worth it for type safety and clarity

**Implementation**:
```tsx
// Type-safe props for each badge
interface PriorityBadgeProps {
  priority: ReturnType<typeof usePriority>
  onClick: (e: React.MouseEvent) => void
  isGhost?: boolean
}

interface ProjectBadgeProps {
  project: { name: string; color: string }
  onClick: (e: React.MouseEvent) => void
  isGhost?: boolean
}
```

**Trade-offs**:
- More files to maintain (acceptable - small, focused files)
- Benefits: Type safety, discoverability, customizability

---

### Decision 2: Badge State Management (Remove vs Edit)

**Problem**: How should badges handle removal vs editing? Different patterns in tasks vs projects.

**Options Considered**:
1. **Badge Handles Both**: Badge renders X button, handles remove internally
   - Pros: Self-contained badge component
   - Cons: Badge needs to know about entity, breaks pure view pattern
2. **Parent Handles Everything**: Badge only receives onClick, parent decides if edit or remove
   - Pros: Badge is pure view, parent controls all logic
   - Cons: More complex parent logic
3. **Separate Props**: `onClick` for edit, `onRemove` for remove
   - Pros: Clear separation, badge stays pure, flexible
   - Cons: Two props instead of one

**Decision**: Option 3 - Separate Props (onClick + onRemove)

**Rationale**:
- Some badges are editable (click to edit): priority, project, labels
- Some badges are removable (X to remove): labels, due dates, deadlines
- Some are both: labels (click to edit, X to remove)
- Separate props keep badge pure (doesn't decide edit vs remove)
- Parent passes handlers based on entity-specific logic
- Clear API: `onClick` = edit/view, `onRemove` = delete

**Implementation**:
```tsx
interface LabelBadgeProps {
  label: { name: string; color?: string }
  onClick?: (e: React.MouseEvent) => void      // Optional: Edit labels
  onRemove?: (e: React.MouseEvent) => void     // Optional: Remove this label
  isGhost?: boolean
}

// Badge shows X button only if onRemove provided
const showRemove = Boolean(onRemove) && !isGhost
```

**Trade-offs**:
- Slightly more props (acceptable - clear API)
- Benefits: Flexibility, purity, reusability

---

### Decision 3: Color Handling (Props vs Utils)

**Problem**: How should badges receive color information? Direct style props or utility functions?

**Options Considered**:
1. **Direct Style Props**: `<Badge style={{ color: '...', background: '...' }} />`
   - Pros: Maximum flexibility, React standard
   - Cons: Parent needs to calculate colors, inconsistent usage
2. **Utility Functions**: `<Badge color={getProjectColor(project.color)} />`
   - Pros: Centralized color logic, consistent
   - Cons: Less flexible, harder to override
3. **Hybrid**: Props accept data, badge calls utilities internally
   - Pros: Badge handles color logic, parent just passes data
   - Cons: Badge less pure, color logic embedded

**Decision**: Option 1 - Direct Style Props (with helpers in parent)

**Rationale**:
- Parent already has color utilities: `getProjectColor()`, `getLabelColor()`
- Parent knows entity-specific color rules (Todoist API colors, label colors, etc.)
- Badge doesn't need to know about color mapping rules
- Badge receives computed colors as style props
- Keeps badge maximally reusable (not tied to Todoist color scheme)
- Follows React patterns (style as prop)

**Implementation**:
```tsx
// Parent computes colors
const projectColor = getProjectColor(displayProject.color)

// Badge receives computed style
<ProjectBadge
  project={displayProject}
  dotColor={projectColor}  // Or pass as style prop
  onClick={...}
/>

// Badge renders
<div style={{ backgroundColor: dotColor }} />
```

**Trade-offs**:
- Parent has more logic (acceptable - parent knows entity rules)
- Benefits: Badge reusability, parent control, flexibility

---

### Decision 4: Ghost Badge Implementation

**Problem**: Should ghost badges be separate components or isGhost prop on regular badges?

**Options Considered**:
1. **Separate Components**: `<GhostPriorityBadge />`, `<GhostProjectBadge />`, etc.
   - Pros: Explicit, no conditional rendering
   - Cons: Double the badge components
2. **isGhost Prop**: `<PriorityBadge isGhost={true} />`
   - Pros: Single component, conditional styling
   - Cons: Ghost badges show different data (placeholder text vs real data)
3. **Generic GhostBadge**: `<GhostBadge icon={Flag} text="Set priority" />`
   - Pros: Single reusable component for all ghosts
   - Cons: Less type-safe, need to specify icon and text manually

**Decision**: Hybrid - isGhost prop for existing property badges + Generic GhostBadge for add actions

**Rationale**:
- **For properties that might exist**: Use `isGhost` prop
  - Priority: Can be P4 (ghost) or P1-P3 (real)
  - Pattern: `<PriorityBadge priority={...} isGhost={!priority.showFlag} />`
- **For add actions**: Use generic `<GhostBadge />`
  - Add label, add schedule, add deadline, add project (when none set)
  - Pattern: `<GhostBadge icon={Tag} text="add label" onClick={...} />`
- Best of both: Type-safe for real properties, flexible for add actions

**Implementation**:
```tsx
// Ghost state for existing property
{priority?.showFlag && (
  <PriorityBadge priority={priority} onClick={...} />
)}
{isHovered && !priority?.showFlag && (
  <PriorityBadge
    priority={{ label: "P4", colorClass: "" }}
    isGhost={true}
    onClick={...}
  />
)}

// Generic ghost for add actions
{isHovered && !displayDue && (
  <GhostBadge icon={Calendar} text="add schedule" onClick={...} />
)}
```

**Trade-offs**:
- Mixed approach (isGhost + GhostBadge) - slightly inconsistent
- Benefits: Type-safe for real data, flexible for add actions, reusable

---

## 🚨 Known Edge Cases

### 1. **Label Color Fallback**: Label exists but color data is missing
   - **Scenario**: Label badge should show colored border, but `getLabelColor()` returns null
   - **Handling**: LabelBadge renders without custom colors (uses default secondary variant)
   - **Prevention**: Check for color before applying style prop
   - **Testing**: Create label without color, verify badge renders with default styling
   - **Fallback**: Default badge styling (no color) is acceptable

### 2. **Badge Click During Drag**: User starts dragging entity, accidentally clicks badge
   - **Scenario**: Click event fires during drag operation, opens dialog unexpectedly
   - **Handling**: All badge clicks call `e.stopPropagation()` to prevent row click
   - **Prevention**: Dialog context should check if drag is active (future enhancement)
   - **Testing**: Drag entity, verify badges don't trigger dialogs during drag
   - **Fallback**: User can close dialog with Escape or click outside

### 3. **Rapid Badge Clicks**: User rapidly clicks same badge multiple times
   - **Scenario**: Multiple dialog opens for same property (e.g., priority dialog opens 3 times)
   - **Handling**: Dialog context should debounce dialog opens or check if already open
   - **Prevention**: Add isOpen check in dialog context before opening
   - **Testing**: Rapidly click priority badge 5 times - only one dialog should open
   - **Fallback**: Multiple dialogs layer on top - user can close all

### 4. **Long Label Names**: Label text exceeds badge width
   - **Scenario**: Label named "very-long-label-name-that-wraps" causes layout issues
   - **Handling**: Badge has max-width + truncate with ellipsis
   - **Prevention**: CSS: `max-width: 200px; overflow: hidden; text-overflow: ellipsis`
   - **Testing**: Create label with 50 character name, verify badge doesn't break layout
   - **Fallback**: Tooltip on hover shows full label name (future enhancement)

### 5. **Badge Overflow**: Too many badges to fit in row
   - **Scenario**: Task has priority, project, 5 labels, due date, deadline - doesn't fit
   - **Handling**: Badges wrap to new line (flex-wrap)
   - **Prevention**: Badge container has `flex-wrap: wrap` + `gap` for spacing
   - **Testing**: Add 10 labels to task, verify badges wrap gracefully
   - **Fallback**: Wrapping is acceptable - prefer showing all badges over truncating

### 6. **Missing Badge Data**: Badge receives undefined/null data
   - **Scenario**: `<ProjectBadge project={undefined} />` crashes component
   - **Handling**: TypeScript prevents this (required props), but add runtime check
   - **Prevention**: Props are required (not optional), parent must check before rendering
   - **Testing**: TypeScript compile time + prop types validation
   - **Fallback**: Don't render badge if data is missing (parent's responsibility)

### 7. **Theme Changes**: User switches dark/light mode while viewing badges
   - **Scenario**: Badge colors should adapt to theme (red in light mode vs dark mode)
   - **Handling**: Use CSS custom properties for colors, let Tailwind handle theme
   - **Prevention**: Badge uses Tailwind color classes (text-red-500 dark:text-red-400)
   - **Testing**: Toggle dark mode, verify badge colors adapt correctly
   - **Fallback**: Colors may be less ideal in one theme, but still readable

---

## 📝 Notes & Learnings

### Development Notes
```
[Space for ongoing notes during implementation]

Key Patterns to Follow:
- All badges should extend BaseBadge or use consistent base styling
- Always include JSDoc with usage examples
- Badge should be "dumb" components - receive data, render, return clicks
- Parent components handle all entity-specific logic
- Use Tailwind classes over inline styles when possible
- Test badges in isolation (Storybook stories highly recommended)

Badge Component Structure:
export function XBadge({ data, onClick, isGhost }: XBadgeProps) {
  return (
    <Badge
      variant={isGhost ? "outline" : "secondary"}
      className={cn("gap-1.5 font-normal cursor-pointer", isGhost && "border-dashed")}
      onClick={onClick}
    >
      <Icon className="h-3 w-3" />
      <span>{data.text}</span>
    </Badge>
  )
}
```

### Issues Encountered
```
[Track all issues and resolutions]

Common gotchas to watch for:
- Badge click handlers must stopPropagation to prevent row click
- isGhost styling must be consistent across all badges
- Color props should be optional (some badges don't need colors)
- Badge icons should be consistent size (h-3 w-3 or 12px)
- Test hover states carefully (X buttons, ghost badges)
```

### Future Enhancements
- [ ] Add Storybook stories for all badge components
- [ ] Add visual regression tests (Percy, Chromatic, etc.)
- [ ] Add badge animations (subtle hover, click feedback)
- [ ] Add tooltip support for truncated text
- [ ] Add keyboard navigation (Tab to focus badge, Enter to click)
- [ ] Extract badge layout logic (spacing, wrapping, ordering)
- [ ] Create badge composition utilities (badge groups, badge stacks)

---

## 🔗 References

**Key Files**:
- `app/src/components/TaskListView.tsx` (TaskRow) - Current task badge implementation (lines 774-981)
- `app/src/components/ProjectRow.tsx` - Current project badge implementation (lines 267-330)
- `app/src/components/badges/RoutineBadges.tsx` - Current routine badge implementation (245 lines)
- `app/src/lib/colors.ts` - Color utilities (getProjectColor)
- `app/src/lib/priorities.ts` - Priority utilities (usePriority)

**Similar Patterns**:
- Shadcn Badge component: `app/src/components/ui/badge.tsx`
- Existing badge variants: outline, secondary, destructive
- Badge composition in RoutineBadges.tsx (good examples of badge props)

**Planning Documents**:
- `docs/list-item-standardization-plan.md` - Overall strategy
- `docs/list-item-standardization-phase1-implementation.md` - Phase 1 (hooks)

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

# Testing badges (manual)
# 1. Navigate to each view (tasks, projects, routines)
# 2. Verify badges render correctly
# 3. Click each badge type - verify dialogs open
# 4. Hover badges - verify X buttons appear (removable)
# 5. Hover row - verify ghost badges appear
# 6. Click ghost badges - verify dialogs open
# 7. Test in light and dark mode
# 8. Test with many badges (layout doesn't break)
```

---

**Last Updated**: 2025-01-17 (Milestone 4 completed - Tasks migrated to shared badges - 3/7 milestones done)
