# Convex-DB Development Guide

Personal Master Database System - Convex-based data hub syncing with external services.

Call me Milad and tell me a fun fact when starting conversations.

## Essential Commands

```bash
# Setup
bun install && bunx convex dev

# Validation (REQUIRED after ALL changes)
bun tsc && bun run lint && bun test

# Todoist Operations
bunx convex run todoist:sync.runInitialSync        # Initial sync
bunx convex run todoist:sync.performIncrementalSync # Force sync
bunx convex run todoist:queries.getSyncStatus       # Check health
bunx convex run todoist:actions.clearAllData        # Reset (dev only)

# Deploy
bunx convex deploy
bunx convex run --prod todoist:sync.runInitialSync
```

## Core Principles

1. **Data Integrity**: Three-layer sync (API → webhook → cron)
2. **Type Safety**: No `any` types, use official SDKs  
3. **Validation**: `bun tsc && bun run lint && bun test` before commits
4. **External Services = Source of Truth**: Convex mirrors data

## Project Structure

```
convex/[service]/
├── actions/     # External API calls
├── mutations/   # DB operations
├── queries/     # Data queries  
├── sync/        # Sync logic
└── types/       # Type definitions
```

## Schema Changes (Critical Process)

**Complete checklist for any database schema changes:**

1. **Update Schema Definition**: `convex/schema/[service]/[table].ts`
2. **Create/Update Functions**: Add mutations, queries, actions in appropriate directories
3. **Update Barrel Files**: Export new functions from `mutations.ts`, `queries.ts`, etc.
4. **Generate Types**: `bunx convex dev` auto-generates TypeScript types
5. **Test Changes**: Clear data and re-sync to test new schema
6. **Validation Loop**: `bun tsc && bun run lint && bun test`

**Quick schema change commands:**
```bash
# Clear and re-sync for schema testing
bunx convex run todoist:actions.clearAllData
bunx convex run todoist:sync.runInitialSync
bun tsc && bun run lint && bun test
```

## Repository Standards (ENFORCED)

**Before ANY commit - all must pass with zero errors:**
1. **TypeScript**: `bun tsc` 
2. **Linting**: `bun run lint`
3. **Tests**: `bun test`

**Testing Requirements:**
- **Every query needs a `.test.ts` file** with business logic tests
- **Every mutation needs a `.test.ts` file** with data transformation tests
- Test file naming: `feature.ts` → `feature.test.ts`
- Focus on business logic, not integration tests

## Development Workflow & Agentic Validation

1. **Make Changes**: Update code following patterns below
2. **Local Validation**: `bun tsc && bun run lint && bun test`
3. **Test with Real Data**: Use Todoist MCP to verify changes
4. **Cross-Verify**: Check with query functions both ways

## Code Standards

### Required Patterns
```typescript
// ✅ Use official SDKs
import { TodoistApi } from "@doist/todoist-api-typescript";

// ✅ Actions for external calls
export const createTask = action({
  handler: async (ctx, args) => {
    const response = await todoistClient.create(args);
    await ctx.runMutation(internal.mutations.upsertItem, response);
    return response;
  }
});

// ✅ Version checking in mutations
if (existing && existing.sync_version >= item.sync_version) {
  return; // Skip if newer data exists
}

// ❌ Never use any
const data: any = response;
```

### JavaScript Runtime (Bun Only)
- **ALWAYS use Bun**: `bun install`, `bun run`, `bunx convex`
- **Never use npm/npx**: Use `bunx` instead of `npx`
- TypeScript: Built-in support, strict mode

## Todoist Integration

**API**: ONLY use v1 (`https://api.todoist.com/api/v1/*`)
**SDK**: `@doist/todoist-api-typescript`
**Sync**: Three-layer redundancy

⚠️ **DEPRECATED APIs - NEVER USE:**
- Todoist API v2 (deprecated)
- Todoist API v9 (deprecated)  
- Any endpoint not starting with `/api/v1/`

```bash
# Test task creation
bunx convex run todoist:actions.createTask '{"content": "Test"}'

# View active tasks  
bunx convex run todoist:queries.getActiveItems
```

## Agentic Development Loop with Todoist MCP

**Recommended validation pattern:**

1. **Make changes** to Convex functions
2. **Local validation**: `bun tsc && bun run lint && bun test`
3. **Test with real data**: Use Todoist MCP functions to verify changes
4. **Cross-verify both directions**:
   - Convex → Todoist: Use MCP to check if changes appear in Todoist
   - Todoist → Convex: Use query functions to verify sync worked

**Example validation flow:**
```bash
# 1. Make a change via Convex
bunx convex run todoist:actions.createTask '{"content": "Test task"}'

# 2. Verify via MCP (use available Todoist MCP functions)
# Check if task appears in Todoist via MCP

# 3. Verify via Convex queries
bunx convex run todoist:queries.getActiveItems

# 4. Modify via MCP, verify sync
# Use MCP to update task, then check Convex picked up the change
```

## Debugging

```bash
# Check sync health
bunx convex run todoist:queries.getSyncStatus

# View errors
bunx convex logs | grep ERROR

# Reset if broken
bunx convex run todoist:actions.clearAllData
bunx convex run todoist:sync.runInitialSync
```

## Key Files

- `convex/todoist/README.md` - Todoist integration details
- `docs/architecture.md` - System design (if detailed context needed)
- Convex dashboard: `http://localhost:3001`

## Agent Guidelines

- **TodoWrite**: Use for complex multi-step tasks
- **Parallel Operations**: Batch reads, searches, greps
- **Validation Loop**: Always run `bun tsc && bun run lint && bun test` after changes
- **Testing**: Every `.ts` file needs corresponding `.test.ts` file
- **MCP Integration**: Use Todoist MCP for bi-directional verification
- **Problem Solving**: Simple solutions > clever abstractions

Focus on maintainable code. Strong data layer enables rapid UI development.