# Projects View Implementation - Project Tracker

**Project**: Convex-DB Projects View Feature
**Owner**: Milad
**Started**: 2025-11-13
**Status**: Planning Complete

---

## 🎯 Project Overview

### Goal
Create a `view:projects` that displays projects as task-like rows with interactive Name, Description, and Priority fields, using the same keyboard shortcuts and UI patterns as tasks.

### Success Criteria
- [ ] Projects view accessible from sidebar (after Priority Queue)
- [ ] Shows only active projects, sorted by priority
- [ ] Name, Description, Priority all inline-editable
- [ ] Keyboard shortcuts work (`Enter`, `Shift+Enter`, `p`)
- [ ] Optimistic updates for instant feedback
- [ ] All changes sync bidirectionally with Todoist
- [ ] All validation passes: `bun run typecheck && bun run lint && bun test`
- [ ] Metadata tasks auto-created on first edit
- [ ] Background sync ensures metadata consistency

---

## 📋 Implementation Milestones

### **Milestone 1: Core View Infrastructure** ✅
**Goal**: Wire up the view system to recognize and route to Projects view

**Tasks**:
- [x] Add `view:projects` to ViewKey type (`app/src/lib/views/types.ts`)
- [x] Register projects view pattern in viewRegistry (`app/src/lib/views/viewRegistry.tsx`)
- [x] Add projects icon to viewIcons (`app/src/lib/icons/viewIcons.tsx`)
- [x] Add `list:projects` count calculation to CountRegistry (`app/src/lib/views/CountRegistry.ts`)
- [x] Add Projects to sidebar after Priority Queue (`app/src/components/layout/Sidebar/utils/viewItems.ts` and `Sidebar.tsx`)
- [x] Add `projects` query type to ListQueryDefinition

**Success Criteria**:
- ✅ Projects view appears in sidebar
- ✅ Clicking Projects navigates to `view:projects`
- ✅ View resolves without errors (even if empty)
- ✅ Count badge shows "0" or correct number
- ✅ Typecheck passes with zero errors

**Completion Notes**:
```
Date: 2025-11-13
Status: COMPLETED
Notes:
- Successfully added view:projects ViewKey type
- Registered view pattern in viewRegistry with placeholder buildLists (returns empty array for now)
- Added Folder icon from lucide-react
- Updated CountRegistry to handle list:projects count key
- Modified sidebar to include Projects view after Priority Queue
- Added projects query type to ListQueryDefinition
- All changes compile successfully (typecheck passed)

Issues encountered:
- None - straightforward implementation following existing patterns

Next steps:
- Milestone 2: Create Convex actions for updateProjectName, updateProjectMetadataDescription, updateProjectMetadataPriority, and ensureProjectMetadataTask
```

---

### **Milestone 2: Convex Actions Layer** ✅
**Goal**: Create API integration layer for project and metadata updates

**Tasks**:
- [x] `updateProjectName` action (no test - following existing pattern)
- [x] `updateProjectMetadataDescription` action (no test - following existing pattern)
- [x] `updateProjectMetadataPriority` action (no test - following existing pattern)
- [x] `ensureProjectMetadataTask` action (no test - following existing pattern)
- [x] Export actions in barrel file (`convex/todoist/publicActions.ts`)

**Success Criteria**:
- ✅ Can manually test actions via Convex dashboard
- ✅ Typecheck passes: `bun run typecheck`

**Completion Notes**:
```
Date: 2025-11-13
Status: COMPLETED & TESTED ✅
Notes:
- Created updateProjectName.ts - Updates Todoist project name via API and syncs to Convex
- Created ensureProjectMetadataTask.ts - Creates metadata task with "project-metadata" label if missing
- Created updateProjectMetadataDescription.ts - Updates metadata task description, ensures task exists first
- Created updateProjectMetadataPriority.ts - Updates metadata task priority, ensures task exists first
- All actions properly call extractProjectMetadata to sync changes back to DB
- All actions follow existing patterns (ActionResponse, error handling, type safety)
- Exported all four actions in publicActions.ts barrel file
- Typecheck passes with zero errors

Integration Testing Results (2025-11-13):
Test Project ID: 6cwJ4VPrwjJHcwGj

✅ updateProjectName
   - Updated: "Test Project" → "Test Project - Updated Name!"
   - Verified: Change synced to Todoist via Todoist MCP
   - Command: bunx convex run todoist/actions/updateProjectName:updateProjectName

✅ ensureProjectMetadataTask
   - Created: Metadata task ID 6fGrwmQP29XhqpgC
   - Verified: Has "project-metadata" label, content "*", default priority P4
   - Command: bunx convex run todoist/actions/ensureProjectMetadataTask:ensureProjectMetadataTask

✅ updateProjectMetadataDescription
   - Updated: "This is a test project for the Projects view feature!"
   - Verified: Description synced to metadata task in Todoist
   - Command: bunx convex run todoist/actions/updateProjectMetadataDescription:updateProjectMetadataDescription

✅ updateProjectMetadataPriority
   - Updated: Priority to P1 (API priority 4)
   - Verified: Red flag shows in Todoist UI
   - Command: bunx convex run todoist/actions/updateProjectMetadataPriority:updateProjectMetadataPriority

Bidirectional Sync: ✅ All changes flow correctly: Convex Action → Todoist API → Todoist MCP verification

Issues encountered:
- Initial type errors with internal function references (resolved by using correct path: internal.todoist.computed.index.extractProjectMetadata)
- Task property mapping (resolved by following createTask.ts pattern)

Next steps:
- Milestone 3: Create ProjectRow and display components
```

---

### **Milestone 3: Display Components** ✅ / ❌
**Goal**: Render projects in a task-like row format (read-only first)

**Tasks**:
- [ ] Create `ProjectRow` component (`app/src/components/ProjectRow.tsx`)
  - Display: color indicator, name, description badge, priority badge
  - No checkbox
  - Handle missing metadata gracefully (show defaults)
- [ ] Add projects list definition to `listDefinitions.tsx`
  - Filter: active only
  - Sort: by priority (4→3→2→1)
  - Query: `getProjectsWithMetadata`

**Success Criteria**:
- Projects view shows all active projects
- Projects sorted by priority (P1, P2, P3, P4)
- Each row displays name, description, priority
- Projects without metadata show defaults (P4, empty description)
- No console errors
- Typecheck passes

**Completion Notes**:
```
Date:
Status:
Visual verification:
Edge cases tested:
- Projects with metadata:
- Projects without metadata:
- Archived projects (should not show):
Issues encountered:
Next steps:
```

---

### **Milestone 4: Interaction Layer** ✅ / ❌
**Goal**: Make name, description, and priority editable

**Tasks**:
- [ ] Name editing (inline input)
  - Click or Enter → edit mode
  - Save on blur or Enter
  - Calls `updateProjectName` action
- [ ] Description editing (inline textarea)
  - Click or Shift+Enter → edit mode
  - Textarea expands below row
  - Save on Cmd+Enter or blur
  - Calls `updateProjectMetadataDescription` action
- [ ] Priority editing (dialog)
  - Click badge or press `p` → priority dialog
  - Calls `updateProjectMetadataPriority` action
- [ ] Create `useProjectDialogShortcuts` hook
  - `Enter` - Edit name
  - `Shift+Enter` - Edit description
  - `p` - Edit priority

**Success Criteria**:
- Can edit project name inline
- Can edit description inline (creates metadata if missing)
- Can change priority via dialog
- Keyboard shortcuts work
- Changes save to Todoist
- Toast notifications on success/error
- Lint passes: `bun run lint`

**Completion Notes**:
```
Date:
Status:
Manual QA:
- Edit name: ✅ / ❌
- Edit description (with metadata): ✅ / ❌
- Edit description (without metadata - should create): ✅ / ❌
- Edit priority: ✅ / ❌
- Keyboard shortcuts: ✅ / ❌
Todoist verification (via MCP):
Issues encountered:
Next steps:
```

---

### **Milestone 5: Optimistic Updates** ✅ / ❌
**Goal**: Instant UI feedback before API confirms

**Tasks**:
- [ ] Create `useOptimisticProjectNameChange` hook
- [ ] Create `useOptimisticProjectDescriptionChange` hook
- [ ] Create `useOptimisticProjectPriorityChange` hook
- [ ] Wire up optimistic context in ProjectRow
- [ ] Test rollback on errors

**Success Criteria**:
- Edits appear instantly in UI
- Loading states clear when DB syncs
- Errors roll back optimistic changes
- Toast shows on error
- Offline edits queue and sync when online

**Completion Notes**:
```
Date:
Status:
Manual QA:
- Instant feedback: ✅ / ❌
- Error rollback: ✅ / ❌
- Offline behavior: ✅ / ❌
Issues encountered:
Next steps:
```

---

### **Milestone 6: Validation & Testing** ✅ / ❌
**Goal**: Ensure code quality and correctness

**Tasks**:
- [ ] Run full validation suite:
  ```bash
  bun run typecheck
  bun run lint
  bun test
  ```
- [ ] Manual QA checklist (see below)
- [ ] Todoist MCP bi-directional testing

**Success Criteria**:
- All validation passes with zero errors
- All manual QA items pass
- Todoist sync verified both directions

**Manual QA Checklist**:
- [ ] View appears in sidebar after Priority Queue
- [ ] Count badge shows correct number
- [ ] Projects sorted by priority
- [ ] Click project name → edit inline → saves
- [ ] Press Enter → edit name
- [ ] Press Shift+Enter → edit description
- [ ] Press p → edit priority
- [ ] Priority badge shows correct color
- [ ] Description shows correctly
- [ ] Projects without metadata show defaults
- [ ] First edit creates metadata task
- [ ] Changes sync to Todoist
- [ ] Todoist changes sync back to Convex
- [ ] Optimistic updates work offline
- [ ] Errors show toast notifications
- [ ] Keyboard navigation works
- [ ] No console errors

**Completion Notes**:
```
Date:
Status:
Validation results:
- typecheck: ✅ / ❌
- lint: ✅ / ❌
- test: ✅ / ❌
Manual QA results:
Failed items:
Issues encountered:
Next steps:
```

---

### **Milestone 7: Metadata Sync Strategy** ✅ / ❌
**Goal**: Ensure all projects have metadata tasks, with repair mechanisms

**Tasks**:
- [ ] Create backfill migration (`convex/todoist/migrations/backfillProjectMetadata.ts`)
- [ ] Run one-time: `bunx convex run todoist:migrations.backfillProjectMetadata`
- [ ] Modify `upsertProject` mutation to auto-create metadata on new projects
- [ ] Add metadata repair check to 5-minute sync cron
- [ ] Test repair mechanism (delete metadata task, wait for sync)

**Success Criteria**:
- All existing active projects have metadata tasks
- New projects get metadata tasks automatically
- Deleted metadata tasks recreated within 5 minutes
- System stays consistent

**Completion Notes**:
```
Date:
Status:
Backfill results:
- Projects processed:
- Metadata tasks created:
Repair mechanism test:
Issues encountered:
Next steps:
```

---

## 📊 Progress Tracking

**Overall Completion**: 2/7 milestones

- [x] Planning & Research
- [x] Milestone 1: Core View Infrastructure
- [x] Milestone 2: Convex Actions Layer
- [ ] Milestone 3: Display Components
- [ ] Milestone 4: Interaction Layer
- [ ] Milestone 5: Optimistic Updates
- [ ] Milestone 6: Validation & Testing
- [ ] Milestone 7: Metadata Sync Strategy

---

## 🗂️ File Inventory

### Files to Create (13)
**Frontend (5)**:
- [ ] `app/src/components/ProjectRow.tsx`
- [ ] `app/src/hooks/useProjectDialogShortcuts.ts`
- [ ] `app/src/hooks/useOptimisticProjectNameChange.ts`
- [ ] `app/src/hooks/useOptimisticProjectDescriptionChange.ts`
- [ ] `app/src/hooks/useOptimisticProjectPriorityChange.ts`

**Backend (4)** (tests not needed per existing pattern):
- [x] `convex/todoist/actions/updateProjectName.ts`
- [x] `convex/todoist/actions/updateProjectMetadataDescription.ts`
- [x] `convex/todoist/actions/updateProjectMetadataPriority.ts`
- [x] `convex/todoist/actions/ensureProjectMetadataTask.ts`

**Migration (1)**:
- [ ] `convex/todoist/migrations/backfillProjectMetadata.ts`

### Files to Modify (8)
- [x] `app/src/lib/views/types.ts`
- [x] `app/src/lib/icons/viewIcons.tsx`
- [x] `app/src/lib/views/viewRegistry.tsx`
- [x] `app/src/lib/views/CountRegistry.ts`
- [x] `app/src/components/layout/Sidebar/utils/viewItems.ts`
- [x] `app/src/components/layout/Sidebar/Sidebar.tsx`
- [x] `convex/todoist/publicActions.ts`
- [ ] `app/src/lib/views/listDefinitions.tsx`

---

## 🔍 Key Technical Decisions

### Data Flow
**Projects ≠ Tasks**: Project name stored in project, but description/priority stored in separate metadata task.

**Edit Flows**:
- Name: Project API → `upsertProject` mutation
- Description/Priority: Task API → `extractProjectMetadata` mutation

### Metadata Creation Strategy
**Lazy + Background Sync**:
1. Display defaults when missing (P4, empty description)
2. Create on first edit (lazy)
3. Background repair every 5 minutes (ensures consistency)
4. One-time backfill for existing projects

### Sorting
**Priority-first** (P1→P2→P3→P4), then alphabetical
- More sort options coming later (will extend list definitions)

### Filtering
**Active only**: `is_deleted === false && is_archived === false`

---

## 🚨 Known Edge Cases

1. **Missing metadata**: Show defaults, create on first edit
2. **Deleted metadata task**: Recreated by background sync
3. **Concurrent edits**: Handled by sync_version + optimistic updates
4. **API failures**: Rollback optimistic updates, show toast
5. **Offline editing**: Queue via optimistic updates, sync when online

---

## 📝 Notes & Learnings

### Development Notes
```
[Add notes here as you work through milestones]
```

### Issues Encountered
```
[Track issues and resolutions here]
```

### Future Enhancements
- [ ] Additional sort options (name, scheduled date, custom order)
- [ ] Hierarchy view (parent/child projects)
- [ ] Grouping by type (area-of-responsibility vs project-type)
- [ ] Bulk operations (archive, change priority)
- [ ] Drag-and-drop reordering
- [ ] Project templates

---

## 🔗 References

**Key Files**:
- Project architecture: `docs/architecture.md`
- Todoist integration: `convex/todoist/README.md`
- View system: `app/src/lib/views/README.md` (if exists)

**Commands**:
```bash
# Development
bunx convex dev

# Validation (REQUIRED before commits)
bun run typecheck && bun run lint && bun test

# Manual testing
bunx convex run todoist:actions.updateProjectName '{"projectId":"...", "name":"..."}'
bunx convex run todoist:publicQueries.getProjectsWithMetadata

# Migration
bunx convex run todoist:migrations.backfillProjectMetadata
```

**Todoist Priority System** (IMPORTANT):
- API Priority 4 = UI P1 (Highest) - Red
- API Priority 3 = UI P2 (High) - Orange
- API Priority 2 = UI P3 (Medium) - Blue
- API Priority 1 = UI P4 (Normal) - No flag

Always use priority utilities from `@/lib/priorities.ts`!

---

**Last Updated**: 2025-11-13 (Milestone 2 complete & tested)
