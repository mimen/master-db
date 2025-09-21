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

## Phase 2: First Test (15 minutes)

### 2.1 Create Test Directory Structure
```
convex/
  todoist/
    __tests__/
      queries.test.ts
      mutations.test.ts
```

### 2.2 Write First Query Test
```typescript
// convex/todoist/__tests__/queries.test.ts
import { test, expect } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../../_generated/api';
import schema from '../../schema';

test('getActiveItems returns only unchecked items', async () => {
  const t = convexTest(schema);
  
  // Insert test data
  await t.run(async (ctx) => {
    await ctx.db.insert('todoist_items', {
      todoist_id: '1',
      content: 'Active task',
      checked: 0,
      is_deleted: 0,
    });
    
    await ctx.db.insert('todoist_items', {
      todoist_id: '2',
      content: 'Completed task',
      checked: 1,
      is_deleted: 0,
    });
  });
  
  // Run query and verify
  const result = await t.query(api.todoist.publicQueries.getActiveItems);
  expect(result).toHaveLength(1);
  expect(result[0].content).toBe('Active task');
});
```

## Phase 3: Test Patterns (30 minutes)

### 3.1 Mutation Test Pattern
```typescript
// convex/todoist/__tests__/mutations.test.ts
import { test, expect } from 'vitest';
import { convexTest } from 'convex-test';
import { api, internal } from '../../_generated/api';
import schema from '../../schema';

test('upsertItem creates or updates item', async () => {
  const t = convexTest(schema);
  
  // Test creation
  await t.mutation(internal.todoist.mutations.upsertItem, {
    item: {
      id: '123',
      content: 'New task',
      checked: false,
      // ... other required fields
    }
  });
  
  // Verify creation
  const items = await t.run(async (ctx) => {
    return ctx.db.query('todoist_items').collect();
  });
  
  expect(items).toHaveLength(1);
  expect(items[0].content).toBe('New task');
});
```

### 3.2 Helper Functions
```typescript
// convex/testHelpers.ts
import { Id } from './_generated/dataModel';

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
```

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

## Example Test Suite Structure

```
convex/
  todoist/
    __tests__/
      queries.test.ts      # Public query tests
      mutations.test.ts    # Internal mutation tests  
      helpers.test.ts      # Utility function tests
  testHelpers.ts          # Shared test utilities
vitest.config.ts         # Vitest configuration
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