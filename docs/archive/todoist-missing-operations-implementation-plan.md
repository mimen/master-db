# Todoist Missing Operations Implementation Plan

## Overview

This document outlines the implementation plan for adding the missing Todoist operations identified through analysis of the [todoist-mutations-analysis.md](../../../Documents/GitHub/todoist-workspace/todoist-port-documentation/backend/todoist-mutations-analysis.md) documentation.

**Status**: Ready to implement - all required schemas, mutations, and types already exist.

**Estimated Effort**: 15 new actions across 5 phases, following existing patterns.

## Current State Analysis

### ✅ What We Have
- Complete CRUD actions for **tasks**: create, update, complete, reopen, delete, move
- Basic bulk operations: `completeMultipleTasks`
- Project metadata management system
- All required database schemas: `todoist_projects`, `todoist_sections`, `todoist_labels`, `todoist_notes`, `todoist_reminders`
- All required mutations: `upsertProject`, `upsertSection`, `upsertLabel`, `upsertNote`, `upsertReminder`
- Complete type definitions in `types/syncApi.ts`

### ❌ What We're Missing
- Project management actions (create, update, delete)
- Section management actions (create, update, delete)  
- Label management actions (create, update, delete)
- Advanced bulk operations (bulk update, move, delete)
- Task enhancement actions (duplicate, add notes, add reminders)

## Implementation Phases

### Phase 1: Project Management Operations ⭐ **HIGH PRIORITY**
*Complete the core project CRUD operations*

#### Actions to Implement
1. **`createProject`** - Create new projects
2. **`updateProject`** - Update project properties (name, color, parent, favorite)
3. **`deleteProject`** - Delete/archive projects

#### Implementation Details
```typescript
// Each action follows this pattern:
export const createProject = action({
  args: {
    name: v.string(),
    color: v.optional(v.string()),
    parentId: v.optional(v.string()),
    isFavorite: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ActionResponse<Project>> => {
    // 1. Call Todoist SDK
    const client = getTodoistClient();
    const project = await client.addProject(args);
    
    // 2. Store using existing mutation
    await ctx.runMutation(internal.todoist.mutations.upsertProject, {
      project: transformToSyncFormat(project)
    });
    
    return { success: true, data: project };
  }
});
```

#### Files to Create
- `convex/todoist/actions/createProject.ts`
- `convex/todoist/actions/updateProject.ts`
- `convex/todoist/actions/deleteProject.ts`

#### Validation Steps
- [ ] Export from `publicActions.ts`
- [ ] Add tests following existing patterns
- [ ] Verify SDK methods exist in `@doist/todoist-api-typescript`
- [ ] Test with real Todoist API
- [ ] Run validation loop: `bun tsc && bun run lint && bun test`

### Phase 2: Section Management Operations
*Complete section CRUD operations for project organization*

#### Actions to Implement
1. **`createSection`** - Create project sections
2. **`updateSection`** - Update section name and order
3. **`deleteSection`** - Delete sections

#### Implementation Pattern
- Follows same pattern as Phase 1
- Uses existing `upsertSection` mutation
- SDK methods: `client.addSection()`, `client.updateSection()`, `client.deleteSection()`

#### Files to Create
- `convex/todoist/actions/createSection.ts`
- `convex/todoist/actions/updateSection.ts`
- `convex/todoist/actions/deleteSection.ts`

### Phase 3: Label Management Operations
*Complete label CRUD for task organization*

#### Actions to Implement
1. **`createLabel`** - Create new labels
2. **`updateLabel`** - Update label name and color
3. **`deleteLabel`** - Delete labels

#### Implementation Pattern
- Uses existing `upsertLabel` mutation
- SDK methods: `client.addLabel()`, `client.updateLabel()`, `client.deleteLabel()`

#### Files to Create
- `convex/todoist/actions/createLabel.ts`
- `convex/todoist/actions/updateLabel.ts`
- `convex/todoist/actions/deleteLabel.ts`

### Phase 4: Advanced Bulk Operations
*Efficiency improvements for managing multiple items*

#### Actions to Implement
1. **`bulkUpdateTasks`** - Update multiple tasks with different properties
2. **`bulkMoveTasks`** - Move multiple tasks to different projects
3. **`bulkDeleteTasks`** - Delete multiple tasks at once

#### Implementation Pattern
```typescript
export const bulkUpdateTasks = action({
  args: {
    updates: v.array(v.object({
      todoistId: v.string(),
      changes: v.object({
        content: v.optional(v.string()),
        priority: v.optional(v.number()),
        projectId: v.optional(v.string()),
        // ... other fields
      })
    }))
  },
  handler: async (ctx, { updates }) => {
    const results = [];
    
    // Process each update individually
    for (const update of updates) {
      try {
        const result = await ctx.runAction(api.todoist.actions.updateTask, {
          todoistId: update.todoistId,
          ...update.changes
        });
        results.push({ success: true, taskId: update.todoistId, data: result.data });
      } catch (error) {
        results.push({ success: false, taskId: update.todoistId, error: error.message });
      }
    }
    
    return {
      totalUpdates: updates.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }
});
```

#### Files to Create
- `convex/todoist/actions/bulkUpdateTasks.ts`
- `convex/todoist/actions/bulkMoveTasks.ts`
- `convex/todoist/actions/bulkDeleteTasks.ts`

### Phase 5: Task Enhancement Operations
*Advanced task features*

#### Actions to Implement
1. **`duplicateTask`** - Create copies of existing tasks
2. **`addTaskNote`** - Add notes/comments to tasks
3. **`addTaskReminder`** - Add reminders to tasks

#### Implementation Notes
- **`duplicateTask`**: Fetch existing task, create new one with copied properties
- **`addTaskNote`**: Uses existing `upsertNote` mutation and `todoist_notes` schema
- **`addTaskReminder`**: Uses existing `upsertReminder` mutation and `todoist_reminders` schema

#### Files to Create
- `convex/todoist/actions/duplicateTask.ts`
- `convex/todoist/actions/addTaskNote.ts`
- `convex/todoist/actions/addTaskReminder.ts`

## Implementation Methodology

### Step-by-Step Process for Each Action

1. **Check SDK Support**
   ```bash
   # Verify method exists in Todoist SDK
   grep -r "addProject\|updateProject" node_modules/@doist/todoist-api-typescript/
   ```

2. **Create Action File**
   ```typescript
   // Follow existing pattern from createTask.ts
   // Use existing ActionResponse<T> type
   // Transform camelCase SDK response to snake_case for mutation
   ```

3. **Add to Barrel Export**
   ```typescript
   // Add to convex/todoist/publicActions.ts
   export { createProject } from "./actions/createProject";
   ```

4. **Create Tests**
   ```typescript
   // actions/__tests__/createProject.test.ts
   describe("createProject", () => {
     test("creates project successfully");
     test("handles API errors gracefully"); 
     test("stores in database correctly");
   });
   ```

5. **Validation Loop**
   ```bash
   bun tsc && bun run lint && bun test
   ```

6. **Manual Testing**
   ```bash
   npx convex run todoist:actions.createProject '{"name": "Test Project"}'
   npx convex run todoist:queries.getProject '{"projectId": "generated-id"}'
   ```

### Error Handling Pattern

All actions use standardized error handling:

```typescript
try {
  const client = getTodoistClient();
  const result = await client.addProject(args);
  await ctx.runMutation(internal.todoist.mutations.upsertProject, {
    project: transformToSyncFormat(result)
  });
  return { success: true, data: result };
} catch (error) {
  console.error("Failed to create project:", error);
  return {
    success: false,
    error: "Failed to create project. Please try again.",
    code: "CREATE_PROJECT_FAILED",
  };
}
```

### Type Transformation Pattern

Convert SDK camelCase to database snake_case:

```typescript
// SDK Response (camelCase)
const project = await client.addProject(args);

// Transform for database (snake_case)
await ctx.runMutation(internal.todoist.mutations.upsertProject, {
  project: {
    id: project.id,
    name: project.name,
    color: project.color,
    parent_id: project.parentId,           // camelCase → snake_case
    child_order: project.childOrder,
    is_deleted: 0,
    is_archived: 0,
    is_favorite: project.isFavorite ? 1 : 0,
    view_style: project.viewStyle,
  }
});
```

## Testing Strategy

### Unit Testing Pattern
Each action gets comprehensive tests:

```typescript
// Example test structure
describe("createProject", () => {
  test("creates project with minimal required fields");
  test("creates project with all optional fields");
  test("transforms camelCase to snake_case correctly");
  test("handles Todoist API rate limits");
  test("handles network failures gracefully");
  test("returns standardized ActionResponse format");
  test("stores project in Convex database");
  test("handles duplicate project names");
});
```

### Integration Testing
Test full flow: Action → Todoist API → Database → Query

```typescript
test("full project creation flow", async () => {
  // 1. Create via action
  const result = await api.todoist.actions.createProject({
    name: "Integration Test Project",
    color: "blue"
  });
  
  expect(result.success).toBe(true);
  
  // 2. Verify stored in database
  const stored = await api.todoist.queries.getProject({
    projectId: result.data.id
  });
  
  expect(stored.name).toBe("Integration Test Project");
  expect(stored.color).toBe("blue");
});
```

### Manual Testing Commands
```bash
# Test each new action
npx convex run todoist:actions.createProject '{"name": "Test Project", "color": "blue"}'
npx convex run todoist:actions.updateProject '{"projectId": "123", "name": "Updated Name"}'
npx convex run todoist:actions.deleteProject '{"projectId": "123"}'

# Verify in database  
npx convex run todoist:queries.getAllProjects
npx convex run todoist:queries.getProject '{"projectId": "123"}'
```

## Risk Assessment & Mitigation

### Low Risk Items ✅
- **Existing Infrastructure**: All schemas, mutations, and types already exist
- **Proven Patterns**: Following exact patterns from existing actions
- **SDK Support**: Official Todoist SDK handles API complexity
- **Testing**: Comprehensive test patterns already established

### Medium Risk Items ⚠️
- **API Rate Limits**: Bulk operations may hit rate limits
  - *Mitigation*: Add delays between bulk operation calls
- **SDK Method Availability**: Some advanced features may not be in SDK
  - *Mitigation*: Check SDK documentation before implementation

### Dependencies
- **Todoist SDK**: `@doist/todoist-api-typescript` - all required methods should exist
- **Existing Mutations**: All required mutations already implemented
- **Type Definitions**: All types already defined in `types/syncApi.ts`

## Success Criteria

### Phase Completion Criteria
Each phase is considered complete when:
- [ ] All actions implemented and tested
- [ ] Exported from `publicActions.ts`
- [ ] Unit tests passing with >90% coverage
- [ ] Integration tests passing
- [ ] Manual testing with real Todoist API successful
- [ ] TypeScript compilation with zero errors
- [ ] Linting passing with zero errors
- [ ] Documentation updated

### Overall Success Criteria
- [ ] All 15 missing operations implemented
- [ ] Feature parity with documentation analysis
- [ ] No breaking changes to existing functionality
- [ ] Performance impact minimal (measured)
- [ ] Error handling consistent across all actions

## Timeline Estimate

### Conservative Estimate (1 developer)
- **Phase 1**: 2-3 days (project operations)
- **Phase 2**: 1-2 days (section operations)  
- **Phase 3**: 1-2 days (label operations)
- **Phase 4**: 2-3 days (bulk operations)
- **Phase 5**: 1-2 days (task enhancements)

**Total**: 7-12 days

### Parallel Development (2 developers)
- **Week 1**: Phases 1-3 (core CRUD operations)
- **Week 2**: Phases 4-5 (advanced features)

**Total**: 2 weeks

## Implementation Order Rationale

1. **Phase 1 First**: Projects are fundamental - many other operations depend on projects
2. **Phases 2-3 Next**: Sections and labels complete the core organization features
3. **Phase 4 Then**: Bulk operations provide efficiency improvements
4. **Phase 5 Last**: Enhancement features are nice-to-have, not critical

## Post-Implementation Tasks

### Documentation Updates
- [ ] Update `convex/todoist/README.md` with new actions
- [ ] Update main CLAUDE.md with new capabilities
- [ ] Create usage examples for each new action

### Monitoring & Observability
- [ ] Add new actions to health monitoring
- [ ] Update error tracking for new error codes
- [ ] Monitor API usage patterns for rate limit optimization

### Future Enhancements
- [ ] Consider caching strategies for bulk operations
- [ ] Evaluate need for optimistic updates in UI
- [ ] Plan webhook support for new entity types
- [ ] Consider batch API calls for improved performance

## Conclusion

This implementation plan provides a clear, phased approach to adding all missing Todoist operations. The existing infrastructure makes this a low-risk, high-value project that will provide complete feature parity with the analysis documentation.

The modular phase approach allows for incremental delivery and testing, ensuring stability throughout the implementation process.