# Convex Testing Setup Notes

## Phase 1 Complete ✅

We successfully completed the basic setup for testing:
1. ✅ Installed dependencies: `vitest`, `@vitest/ui`, `convex-test`, `@edge-runtime/vm`
2. ✅ Created `vitest.config.ts`
3. ✅ Added test scripts to `package.json`
4. ✅ Created test utilities structure
5. ✅ Created first test file

## Known Issues with Bun

**Important**: `convex-test` currently has compatibility issues with Bun because it requires Vite's `import.meta.glob` feature, which Bun doesn't support.

Additionally, Convex's `query`, `mutation`, and `action` wrappers don't expose the handler function directly, making unit testing more challenging.

### Workarounds:
1. **Use Node/npm for convex-test**: Run `npm test` for tests that use convex-test
2. **Test business logic separately**: Extract and test pure logic functions
3. **Use simplified tests**: Test the logic patterns without the Convex wrappers

### Working Test Pattern (for direct handler testing):
```typescript
import { convexTest } from 'convex-test';
import schema from '../../schema';
import { getActiveItems } from './getActiveItems';

test('example', async () => {
  const t = convexTest(schema);
  
  // Seed data
  await t.run(async (ctx) => {
    await ctx.db.insert('todoist_items', mockData);
  });
  
  // Test handler directly
  const result = await t.run(async (ctx) => {
    return await getActiveItems.handler(ctx, args);
  });
  
  expect(result).toBe(expected);
});
```

## Next Steps

Once the Bun compatibility is resolved or when using Node:
1. Continue with Phase 2: Write tests for critical queries and mutations
2. Set up CI/CD integration
3. Add integration tests for sync functionality