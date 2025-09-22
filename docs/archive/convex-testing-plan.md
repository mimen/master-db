# Convex Backend Unit Testing Implementation Plan

## Overview
Simple, pragmatic approach to testing Convex queries and mutations using `convex-test` and Vitest.

## Phase 1: Basic Setup (30 minutes)

### 1.1 Install Dependencies
```bash
bun add -D vitest @vitest/ui convex-test @edge-runtime/vm
```

### 1.2 Create Vitest Config
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    globals: true,
  },
});
```

### 1.3 Add Test Scripts
```json
// package.json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui"
  }
}
```

## Phase 2: Test Organization Structure (15 minutes)

### Test Location Best Practices for Convex

Based on official Convex documentation and community practices:
1. **Tests SHOULD be inside the convex/ folder** - This is the standard pattern
2. **Test files end with `.test.ts`** - Convex and Vitest will recognize these
3. **Two valid organization patterns**:
   - **Alongside source**: `createTask.ts` and `createTask.test.ts` in same folder
   - **In tests subfolder**: Tests grouped in subdirectories (though we prefer alongside)
4. **Both patterns work** - Choose based on team preference

### 2.1 Folder Structure - Tests Alongside Source Files
```
convex/
  todoist/
    actions/                    # Public actions
      createTask.ts
      createTask.test.ts        # Test alongside source
      updateTask.ts
      updateTask.test.ts
      completeTask.ts
      completeTask.test.ts
      utils/
        todoistClient.ts
    mutations/                  # Internal mutations  
      upsertItem.ts
      upsertItem.test.ts       
      updateItem.ts
      updateItem.test.ts
      upsertProject.ts
      upsertProject.test.ts
    queries/                    # Public queries
      getActiveItems.ts
      getActiveItems.test.ts
      getProjects.ts
      getProjects.test.ts
      getProjectWithItemCount.ts
      getProjectWithItemCount.test.ts
    internal/                   # Internal queries
      getSyncState.ts
      getSyncState.test.ts
    sync/                       # Sync actions
      performIncrementalSync.ts
      performIncrementalSync.test.ts
      runInitialSync.ts
      runInitialSync.test.ts
    test-utils/                 # Shared test resources only
      fixtures/                 # Test data factories
        items.ts
        projects.ts
        sections.ts
        labels.ts
      helpers/                  # Test utilities
        db.ts
        mocks.ts
        setup.ts
```

### 2.2 Naming Convention
- **Test files**: Mirror source file names with `.test.ts` extension
- **Test suites**: Use `describe()` blocks matching the source file name
- **Test cases**: Start with the function name being tested

### 2.3 Example Test File Structure
```typescript
// convex/todoist/queries/getActiveItems.test.ts
import { describe, test, expect, beforeEach } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../../_generated/api';
import schema from '../../schema';
import { createMockTodoistItem } from '../test-utils/fixtures/items';

describe('todoist/queries/getActiveItems', () => {
  let t: ReturnType<typeof convexTest>;
  
  beforeEach(() => {
    t = convexTest(schema);
  });

  test('returns only unchecked, non-deleted items', async () => {
    // Setup test data
    await t.run(async (ctx) => {
      await ctx.db.insert('todoist_items', createMockTodoistItem({
        todoist_id: '1',
        content: 'Active task',
        checked: 0,
        is_deleted: 0,
      }));
      
      await ctx.db.insert('todoist_items', createMockTodoistItem({
        todoist_id: '2',
        content: 'Completed task',
        checked: 1,
        is_deleted: 0,
      }));
    });
    
    // Execute and verify
    const result = await t.query(api.todoist.queries.getActiveItems.getActiveItems);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Active task');
  });

  test('filters by projectId when provided', async () => {
    // Setup test data
    await t.run(async (ctx) => {
      await ctx.db.insert('todoist_items', createMockTodoistItem({
        todoist_id: '1',
        content: 'Project A task',
        project_id: 'project-a',
        checked: 0,
        is_deleted: 0,
      }));
      
      await ctx.db.insert('todoist_items', createMockTodoistItem({
        todoist_id: '2',
        content: 'Project B task',
        project_id: 'project-b',
        checked: 0,
        is_deleted: 0,
      }));
    });
    
    // Execute with projectId filter
    const result = await t.query(api.todoist.queries.getActiveItems.getActiveItems, {
      projectId: 'project-a'
    });
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Project A task');
  });

  test('orders by child_order', async () => {
    // Test ordering logic
  });
});
```

## Phase 3: Test Patterns (30 minutes)

### 3.1 Test Fixtures Organization
```typescript
// convex/todoist/test-utils/fixtures/items.ts
export function createMockTodoistItem(overrides = {}) {
  return {
    todoist_id: '123',
    content: 'Test task',
    checked: 0,
    is_deleted: 0,
    project_id: 'inbox',
    user_id: 'test-user',
    parent_id: null,
    section_id: null,
    priority: 1,
    child_order: 1,
    day_order: -1,
    collapsed: 0,
    labels: [],
    added_by_uid: 'test-user',
    assigned_by_uid: null,
    responsible_uid: null,
    added_at: new Date().toISOString(),
    description: '',
    duration: null,
    duration_unit: null,
    ...overrides,
  };
}

// convex/todoist/test-utils/fixtures/projects.ts
export function createMockProject(overrides = {}) {
  return {
    todoist_id: 'project-123',
    name: 'Test Project',
    color: 'blue',
    parent_id: null,
    child_order: 1,
    collapsed: 0,
    shared: false,
    can_assign_tasks: true,
    is_deleted: 0,
    is_archived: 0,
    is_favorite: 0,
    inbox_project: false,
    team_inbox: false,
    view_style: 'list',
    ...overrides,
  };
}
```

### 3.2 Test Helper Utilities
```typescript
// convex/todoist/test-utils/helpers/db.ts
import { ConvexTestingHelper } from 'convex-test';

export async function seedDatabase(t: ConvexTestingHelper, data: {
  items?: any[],
  projects?: any[],
  sections?: any[]
}) {
  await t.run(async (ctx) => {
    if (data.projects) {
      for (const project of data.projects) {
        await ctx.db.insert('todoist_projects', project);
      }
    }
    
    if (data.sections) {
      for (const section of data.sections) {
        await ctx.db.insert('todoist_sections', section);
      }
    }
    
    if (data.items) {
      for (const item of data.items) {
        await ctx.db.insert('todoist_items', item);
      }
    }
  });
}

export async function cleanDatabase(t: ConvexTestingHelper) {
  await t.run(async (ctx) => {
    // Clean all tables
    const tables = ['todoist_items', 'todoist_projects', 'todoist_sections'];
    for (const table of tables) {
      const items = await ctx.db.query(table).collect();
      for (const item of items) {
        await ctx.db.delete(item._id);
      }
    }
  });
}
```

### 3.3 Complete Test File Example
```typescript
// convex/todoist/mutations/upsertItem.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { convexTest } from 'convex-test';
import { internal } from '../../_generated/api';
import schema from '../../schema';
import { createMockTodoistItem } from '../test-utils/fixtures/items';
import { seedDatabase, cleanDatabase } from '../test-utils/helpers/db';

describe('todoist/mutations/upsertItem', () => {
  let t: ReturnType<typeof convexTest>;
  
  beforeEach(() => {
    t = convexTest(schema);
  });
  
  afterEach(async () => {
    await cleanDatabase(t);
  });

  describe('upsertItem', () => {
    test('creates new item when it does not exist', async () => {
      const mockItem = createMockTodoistItem({
        todoist_id: 'new-123',
        content: 'Brand new task',
      });
      
      await t.mutation(internal.todoist.mutations.upsertItem.upsertItem, {
        item: mockItem
      });
      
      const items = await t.run(async (ctx) => {
        return ctx.db.query('todoist_items')
          .filter(q => q.eq(q.field('todoist_id'), 'new-123'))
          .collect();
      });
      
      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('Brand new task');
    });

    test('updates existing item based on todoist_id', async () => {
      // Seed with existing item
      await seedDatabase(t, {
        items: [createMockTodoistItem({
          todoist_id: 'existing-123',
          content: 'Old content',
          checked: 0,
        })]
      });
      
      // Update the item
      await t.mutation(internal.todoist.mutations.upsertItem.upsertItem, {
        item: createMockTodoistItem({
          todoist_id: 'existing-123',
          content: 'Updated content',
          checked: 1,
          sync_version: 2,
        })
      });
      
      // Verify update
      const items = await t.run(async (ctx) => {
        return ctx.db.query('todoist_items')
          .filter(q => q.eq(q.field('todoist_id'), 'existing-123'))
          .collect();
      });
      
      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('Updated content');
      expect(items[0].checked).toBe(1);
    });
  });

  describe('softDeleteItem', () => {
    test('sets is_deleted flag without removing record', async () => {
      // Test implementation
    });
  });
});

## Phase 4: CI/CD Integration (15 minutes)

### 4.1 GitHub Actions Workflow
```yaml
# .github/workflows/test.yml
name: Run Tests

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      
      - name: Install dependencies
        run: bun install
      
      - name: Run tests
        run: bun test
```

## Test Coverage Guidelines

### What to Test
1. **Query Logic**: Filters, sorting, pagination
2. **Mutation Validation**: Required fields, data integrity
3. **Business Rules**: Soft deletes, version conflicts
4. **Error Cases**: Missing data, invalid inputs

### What NOT to Test
1. **External API calls** (test in integration tests)
2. **Webhook handlers** (test separately)
3. **Sync logic** (as requested)
4. **Convex framework internals**

## Quick Start Commands

```bash
# 1. Install dependencies
bun add -D vitest @vitest/ui convex-test @edge-runtime/vm

# 2. Create first test file
mkdir -p convex/todoist/test-utils/fixtures
touch convex/todoist/queries/getActiveItems.test.ts

# 3. Run tests
bun test

# 4. Watch mode for development
bun test:watch
```

## Recommended Convex File Organization

### Standard Convex Pattern - One Function Per File with Tests Alongside
```
convex/
  todoist/
    queries/                    # Public queries (one per file)
      getActiveItems.ts
      getActiveItems.test.ts    # Test right next to source        
      getProjects.ts
      getProjects.test.ts
      getProjectWithItemCount.ts
      getProjectWithItemCount.test.ts
    
    mutations/                  # Internal mutations
      upsertItem.ts
      upsertItem.test.ts
      upsertProject.ts
      upsertProject.test.ts
      softDeleteItem.ts
      softDeleteItem.test.ts
    
    actions/                    # Public actions (API calls)
      createTask.ts
      createTask.test.ts
      updateTask.ts
      updateTask.test.ts
      completeTask.ts
      completeTask.test.ts
    
    internal/                   # Internal actions/queries
      sync/
        performIncrementalSync.ts
        performFullSync.ts
      debug/
        getRecentWebhooks.ts
        clearAllData.ts
    
    test-utils/                 # Shared test utilities
      fixtures/
        items.ts
        projects.ts
        sections.ts
      helpers/
        db.ts
        mocks.ts
    
    index.ts                    # Optional: re-exports for cleaner imports
    schema.ts                   # Todoist-specific schema if needed
  
  # Global convex files
  schema.ts                     # Main schema definition
  crons.ts                      # Cron jobs
  
  # Global test utilities
  test-utils/
    helpers/
      convex.ts                # Global test helpers
      testSchema.ts            # Test-specific schema helpers
      
vitest.config.ts
```

### Benefits of One Function Per File

1. **Better Code Organization** - Easy to find specific functions
2. **Improved Testing** - Clear 1:1 mapping between function and test
3. **Easier Code Review** - Changes isolated to specific functions
4. **Better Type Inference** - Convex generates better types
5. **Simpler Imports** - Can import specific functions directly

### Example File Structure

```typescript
// convex/todoist/queries/getActiveItems.ts
import { query } from "../../_generated/server";
import { v } from "convex/values";

export const getActiveItems = query({
  args: {
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("todoist_items")
      .filter((q) => q.eq(q.field("checked"), 0))
      .filter((q) => q.eq(q.field("is_deleted"), 0));

    if (args.projectId) {
      q = q.filter((q) => q.eq(q.field("project_id"), args.projectId));
    }

    const items = await q.collect();
    return items.sort((a, b) => a.child_order - b.child_order);
  },
});
```

```typescript
// convex/todoist/queries/getActiveItems.test.ts
import { describe, test, expect } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../../_generated/api';
import schema from '../../schema';
import { createMockTodoistItem } from '../test-utils/fixtures/items';

describe('getActiveItems', () => {
  test('returns only active, non-deleted items', async () => {
    const t = convexTest(schema);
    
    // Seed test data
    await t.run(async (ctx) => {
      await ctx.db.insert('todoist_items', createMockTodoistItem({
        todoist_id: '1',
        content: 'Active task',
        checked: 0,
        is_deleted: 0,
      }));
      
      await ctx.db.insert('todoist_items', createMockTodoistItem({
        todoist_id: '2',
        content: 'Deleted task',
        checked: 0,
        is_deleted: 1,
      }));
    });
    
    // Test the query
    const result = await t.query(api.todoist.queries.getActiveItems.getActiveItems, {});
    
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Active task');
  });
  
  test('filters by projectId when provided', async () => {
    // Test implementation
  });
});
```

### Migration Strategy

1. **Start with new functions** - Write new functions in the proper structure
2. **Gradual refactoring** - Move existing functions one at a time
3. **Update imports** - Use index files to maintain backward compatibility

```typescript
// convex/todoist/index.ts - Optional for cleaner imports
export * from './queries/getActiveItems';
export * from './queries/getProjects';
export * from './mutations/upsertItem';
// etc...
```

## Best Practices

### 1. File Organization Rules
- **One test file per source file** - Never mix tests for different source files
- **Mirror the source structure** - Test files follow exact same hierarchy
- **Shared fixtures in `fixtures/`** - Reusable test data factories
- **Test helpers in `helpers/`** - Database utilities, custom assertions

### 2. Test Isolation
- Each test file should be completely independent
- Use `beforeEach` to create fresh test context
- Use `afterEach` to clean up test data
- Never rely on test execution order

### 3. Descriptive Test Structure
```typescript
describe('filename', () => {              // Top level: source file name
  describe('functionName', () => {        // Second level: function being tested
    test('specific behavior', () => {     // Third level: specific test case
      // Arrange - Act - Assert
    });
  });
});
```

## Next Steps

1. **Start Small**: Test one critical query first
2. **Build Patterns**: Create reusable test helpers
3. **Add Coverage**: Gradually test more functions
4. **Monitor CI**: Ensure tests run on every PR

## Resources

- [Convex Testing Guide](https://docs.convex.dev/testing/convex-test)
- [Vitest Documentation](https://vitest.dev/)
- [CI Testing with Convex](https://docs.convex.dev/testing/ci)