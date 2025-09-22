# Agentic Development Loops

## Overview

This project is optimized for agentic development patterns where AI agents can validate changes through multiple mechanisms and iterate toward clean, working solutions.

## Validation Loop Pattern

### Complete Validation Cycle
```bash
# 1. Make changes
# 2. Run validation loop
bun tsc && bun run lint && bun test

# 3. Test with real data
npx convex run todoist:sync.performIncrementalSync

# 4. Validate with MCP server (if available)
# Use Todoist MCP to verify changes match expectations

# 5. Check logs for issues
npx convex logs | grep ERROR
```

## Multi-Layer Validation

### 1. TypeScript Validation
```bash
bun tsc  # Must pass with zero errors
```
- Catches type mismatches
- Validates schema consistency
- Ensures proper imports/exports

### 2. Linting Validation
```bash
bun run lint:fix  # Auto-fix what's possible
bun run lint      # Must pass with zero errors
```
- Enforces code style consistency
- Catches common patterns issues
- Validates import organization

### 3. Unit Test Validation
```bash
bun test  # All tests must pass
```
- Validates business logic
- Tests data transformations
- Ensures existing functionality works

### 4. Live System Validation
```bash
# Test sync operations
npx convex run todoist:sync.runInitialSync
npx convex run todoist:queries.getSyncStatus

# Test specific operations
npx convex run todoist:actions.createTask '{"content": "Test task"}'
npx convex run todoist:queries.getActiveItems

# Validate with MCP server
# Use mcp__todoist-mcp__get-tasks to verify data matches
# Use mcp__todoist-mcp__add-task to test compatibility
```

### 5. MCP Server Validation
Use the Todoist MCP server (already configured in Claude):
- Validate changes against live Todoist data with `mcp__todoist-mcp__*` functions
- Cross-reference sync accuracy
- Verify API compatibility
- Test new functions against real Todoist state

## Schema Change Validation Loop

### Complete Schema Change Process
```bash
# 1. Update schema files
# convex/schema/todoist/[table].ts

# 2. Update barrel exports if needed
# convex/todoist/mutations.ts (add new exports)

# 3. Run validation
bun tsc  # Check for type errors

# 4. Test with real data
npx convex run todoist:actions.clearAllData
npx convex run todoist:sync.runInitialSync

# 5. Verify in Convex dashboard
# Check data appears correctly

# 6. Run full validation
bun run lint && bun test
```

**Note**: Usually don't need to manually update types - Convex auto-generates them.

## Error Recovery Loops

### When Validation Fails
1. **TypeScript Errors**: Fix type mismatches, check imports
2. **Lint Errors**: Run `bun run lint:fix`, then fix remaining manually
3. **Test Failures**: Check business logic, update test expectations
4. **Sync Errors**: Check API connectivity, token validity, schema compatibility

### Debugging Loop
```bash
# Check what's broken
npx convex run todoist:queries.getSyncStatus

# View detailed errors
npx convex logs | tail -20

# Reset if needed
npx convex run todoist:actions.clearAllData
npx convex run todoist:sync.runInitialSync

# Validate fix
bun tsc && bun run lint && bun test
```

## Agent Development Best Practices

### Incremental Changes
- Make small, focused changes
- Validate after each change
- Use TodoWrite to track progress

### Validation Before Commit
```bash
# Complete validation before any commit
bun tsc && bun run lint && bun test && npx convex run todoist:queries.getSyncStatus
```

### Testing Changes
- Create test tasks/data to verify functionality
- Use actual Todoist data for integration testing
- Clear and resync to test schema changes

### File Organization Validation
When creating new files:
1. Create the function file: `actions/newFeature.ts`
2. Create parallel test: `actions/newFeature.test.ts`
3. Update barrel export: `actions.ts` or `mutations.ts`
4. Validate imports work: `import { newFeature } from "../actions"`

## Common Validation Patterns

### New Action Validation
```typescript
// 1. Create action with proper types
export const newAction = action({
  args: { content: v.string() },
  handler: async (ctx, args) => {
    const client = getTodoistClient();
    const result = await client.someMethod(args);
    await ctx.runMutation(internal.mutations.store, result);
    return { success: true, data: result };
  }
});

// 2. Test it
npx convex run todoist:actions.newAction '{"content": "test"}'

// 3. Validate side effects
npx convex run todoist:queries.getActiveItems
```

### Schema Validation
```bash
# After schema changes, always:
npx convex run todoist:actions.clearAllData
npx convex run todoist:sync.runInitialSync

# Check data in dashboard
# Run tests to ensure compatibility
bun test
```

## Automated Validation Scripts

### Pre-commit Hook (Future)
```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Running validation loop..."
bun tsc || exit 1
bun run lint || exit 1
bun test || exit 1

echo "Testing sync health..."
npx convex run todoist:queries.getSyncStatus || exit 1

echo "All validations passed!"
```

### Development Validation Script
```bash
#!/bin/bash
# scripts/validate.sh

echo "🔍 TypeScript validation..."
bun tsc

echo "🧹 Linting..."
bun run lint:fix
bun run lint

echo "🧪 Testing..."
bun test

echo "🔄 Sync validation..."
npx convex run todoist:queries.getSyncStatus

echo "✅ All validation complete!"
```

This approach ensures that agents can iterate quickly while maintaining system reliability through comprehensive validation at each step.