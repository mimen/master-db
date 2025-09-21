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

### 2.1 Folder Structure - One Test File Per Source File
```
convex/
  todoist/
    queries.ts
    mutations.ts
    publicQueries.ts
    publicActions.ts
    debug.ts
    __tests__/
      queries.test.ts         # Tests for queries.ts
      mutations.test.ts       # Tests for mutations.ts
      publicQueries.test.ts   # Tests for publicQueries.ts
      publicActions.test.ts   # Tests for publicActions.ts
      debug.test.ts          # Tests for debug.ts
      __fixtures__/          # Shared test data
        items.ts
        projects.ts
      __helpers__/           # Test utilities
        db.ts
        mocks.ts
```

### 2.2 Naming Convention
- **Test files**: Mirror source file names with `.test.ts` extension
- **Test suites**: Use `describe()` blocks matching the source file name
- **Test cases**: Start with the function name being tested

### 2.3 Example Test File Structure
```typescript
// convex/todoist/__tests__/publicQueries.test.ts
import { describe, test, expect, beforeEach } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../../_generated/api';
import schema from '../../schema';
import { createMockTodoistItem } from './__fixtures__/items';

describe('todoist/publicQueries', () => {
  let t: ReturnType<typeof convexTest>;
  
  beforeEach(() => {
    t = convexTest(schema);
  });

  describe('getActiveItems', () => {
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
      const result = await t.query(api.todoist.publicQueries.getActiveItems);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Active task');
    });

    test('excludes soft-deleted items', async () => {
      // Test soft deletion behavior
    });

    test('orders by priority and child_order', async () => {
      // Test ordering logic
    });
  });

  describe('getItemById', () => {
    test('returns item when found', async () => {
      // Test happy path
    });

    test('returns null when not found', async () => {
      // Test not found case
    });
  });
});
```

## Phase 3: Test Patterns (30 minutes)

### 3.1 Test Fixtures Organization
```typescript
// convex/todoist/__tests__/__fixtures__/items.ts
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

// convex/todoist/__tests__/__fixtures__/projects.ts
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
// convex/todoist/__tests__/__helpers__/db.ts
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
// convex/todoist/__tests__/mutations.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { convexTest } from 'convex-test';
import { internal } from '../../_generated/api';
import schema from '../../schema';
import { createMockTodoistItem } from './__fixtures__/items';
import { seedDatabase, cleanDatabase } from './__helpers__/db';

describe('todoist/mutations', () => {
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
      
      await t.mutation(internal.todoist.mutations.upsertItem, {
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
      await t.mutation(internal.todoist.mutations.upsertItem, {
        item: createMockTodoistItem({
          todoist_id: 'existing-123',
          content: 'Updated content',
          checked: 1,
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
mkdir -p convex/todoist/__tests__
touch convex/todoist/__tests__/queries.test.ts

# 3. Run tests
bun test

# 4. Watch mode for development
bun test:watch
```

## Recommended Convex File Organization

### Standard Convex Pattern - One Function Per File
```
convex/
  todoist/
    queries/                    # Public queries (one per file)
      getActiveItems.ts        
      getProjects.ts
      getProjectWithItemCount.ts
      __tests__/
        getActiveItems.test.ts
        getProjects.test.ts
        getProjectWithItemCount.test.ts
    
    mutations/                  # Internal mutations
      upsertItem.ts
      upsertProject.ts
      softDeleteItem.ts
      __tests__/
        upsertItem.test.ts
        upsertProject.test.ts
        softDeleteItem.test.ts
    
    actions/                    # Public actions (API calls)
      createTask.ts
      updateTask.ts
      completeTask.ts
      __tests__/
        createTask.test.ts
        updateTask.test.ts
        completeTask.test.ts
    
    internal/                   # Internal actions/queries
      sync/
        performIncrementalSync.ts
        performFullSync.ts
      debug/
        getRecentWebhooks.ts
        clearAllData.ts
    
    __tests__/                  # Shared test utilities
      __fixtures__/
        items.ts
        projects.ts
        sections.ts
      __helpers__/
        db.ts
        mocks.ts
    
    index.ts                    # Optional: re-exports for cleaner imports
    schema.ts                   # Todoist-specific schema if needed
  
  # Global convex files
  schema.ts                     # Main schema definition
  crons.ts                      # Cron jobs
  
  # Global test utilities
  __tests__/
    __helpers__/
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
// convex/todoist/queries/__tests__/getActiveItems.test.ts
import { describe, test, expect } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../../../_generated/api';
import schema from '../../../schema';
import { createMockTodoistItem } from '../../__tests__/__fixtures__/items';

describe('getActiveItems', () => {
  test('returns only active, non-deleted items', async () => {
    const t = convexTest(schema);
    
    // Test implementation
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
- **Shared fixtures in `__fixtures__`** - Reusable test data factories
- **Test helpers in `__helpers__`** - Database utilities, custom assertions

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