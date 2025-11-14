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

### **Milestone 1: Core View Infrastructure** ✅ / ❌
**Goal**: Wire up the view system to recognize and route to Projects view

**Tasks**:
- [ ] Add `view:projects` to ViewKey type (`app/src/lib/views/types.ts`)
- [ ] Register projects view pattern in viewRegistry (`app/src/lib/views/viewRegistry.tsx`)
- [ ] Add projects icon to viewIcons (`app/src/lib/views/viewIcons.ts`)
- [ ] Add `list:projects` count calculation to CountRegistry (`app/src/lib/views/CountRegistry.ts`)
- [ ] Add Projects to sidebar after Priority Queue (`app/src/components/Sidebar.tsx`)

**Success Criteria**:
- Projects view appears in sidebar
- Clicking Projects navigates to `view:projects`
- View resolves without errors (even if empty)
- Count badge shows "0" or correct number

**Completion Notes**:
```
Date:
Status:
Notes:
Issues encountered:
Next steps:
```

---

### **Milestone 2: Convex Actions Layer** ✅ / ❌
**Goal**: Create API integration layer for project and metadata updates

**Tasks**:
- [ ] `updateProjectName` action + test
- [ ] `updateProjectMetadataDescription` action + test
- [ ] `updateProjectMetadataPriority` action + test
- [ ] `ensureProjectMetadataTask` action + test
- [ ] Export actions in barrel file (`convex/todoist/actions.ts`)

**Success Criteria**:
- All tests pass: `bun test`
- Can manually test actions:
  ```bash
  bunx convex run todoist:actions.updateProjectName '{"projectId":"...", "name":"Test"}'
  bunx convex run todoist:actions.ensureProjectMetadataTask '{"projectId":"..."}'
  ```
- Changes appear in Todoist (verify via Todoist MCP)
- Typecheck passes: `bun run typecheck`

**Completion Notes**:
```
Date:
Status:
Test results:
Manual verification:
Issues encountered:
Next steps:
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

**Overall Completion**: 0/7 milestones

- [x] Planning & Research
- [ ] Milestone 1: Core View Infrastructure
- [ ] Milestone 2: Convex Actions Layer
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

**Backend (8)**:
- [ ] `convex/todoist/actions/updateProjectName.ts`
- [ ] `convex/todoist/actions/updateProjectName.test.ts`
- [ ] `convex/todoist/actions/updateProjectMetadataDescription.ts`
- [ ] `convex/todoist/actions/updateProjectMetadataDescription.test.ts`
- [ ] `convex/todoist/actions/updateProjectMetadataPriority.ts`
- [ ] `convex/todoist/actions/updateProjectMetadataPriority.test.ts`
- [ ] `convex/todoist/actions/ensureProjectMetadataTask.ts`
- [ ] `convex/todoist/actions/ensureProjectMetadataTask.test.ts`

**Migration (1)**:
- [ ] `convex/todoist/migrations/backfillProjectMetadata.ts`

### Files to Modify (7)
- [ ] `app/src/lib/views/types.ts`
- [ ] `app/src/lib/views/viewRegistry.tsx`
- [ ] `app/src/lib/views/viewIcons.ts`
- [ ] `app/src/lib/views/listDefinitions.tsx`
- [ ] `app/src/lib/views/CountRegistry.ts`
- [ ] `app/src/components/Sidebar.tsx`
- [ ] `convex/todoist/actions.ts`

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

**Last Updated**: 2025-11-13
