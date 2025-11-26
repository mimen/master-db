# Convex-DB Development Guide

Personal Master Database System - Convex-based data hub syncing with external services.

Call me Milad and tell me a fun fact when starting conversations.

## Essential Commands

```bash
# Setup
bun install && bunx convex dev

# Validation (REQUIRED after ALL changes)
bun run typecheck && bun run lint && bun test

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
3. **Validation**: `bun run typecheck && bun run lint && bun test` before commits
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
6. **Validation Loop**: `bun run typecheck && bun run lint && bun test`

**Quick schema change commands:**
```bash
# Clear and re-sync for schema testing
bunx convex run todoist:actions.clearAllData
bunx convex run todoist:sync.runInitialSync
bun run typecheck && bun run lint && bun test
```

## Convex Dev Server Reload (CRITICAL)

**When to reload:** After creating, deleting, or renaming exported Convex functions

**Symptoms of stale server:**
- "Could not find public function" errors in frontend
- Changes to function logic not taking effect
- New functions not appearing in API

**How to reload:**
```bash
# One-time reload (for batch changes)
bunx convex dev --once

# OR restart your continuous dev server
# Kill existing: Ctrl+C
bunx convex dev
```

**Note:** If running `bunx convex dev` in watch mode, it should auto-reload. If changes don't appear, manually reload with `--once`.

## Repository Standards (ENFORCED)

**Before ANY commit - all must pass with zero errors:**
1. **TypeScript**: `bun run typecheck` 
2. **Linting**: `bun run lint`
3. **Tests**: `bun test`

**Testing Requirements:**
- **Every query needs a `.test.ts` file** with business logic tests
- **Every mutation needs a `.test.ts` file** with data transformation tests
- Test file naming: `feature.ts` → `feature.test.ts`
- Focus on business logic, not integration tests

## Development Workflow & Agentic Validation

1. **Make Changes**: Update code following patterns below
2. **Local Validation**: `bun run typecheck && bun run lint && bun test`
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

### Critical: Todoist Priority System

⚠️ **IMPORTANT**: Todoist's API uses inverted priority numbers compared to their UI:

- **API Priority 4** = **UI P1** (Highest Priority) - 🔴 Red flag
- **API Priority 3** = **UI P2** (High Priority) - 🟠 Orange flag  
- **API Priority 2** = **UI P3** (Medium Priority) - 🔵 Blue flag
- **API Priority 1** = **UI P4** (Normal Priority) - No flag

**Always use the priority utilities to prevent confusion:**

```typescript
// ✅ CORRECT - Use the abstraction
import { usePriority } from "@/lib/priorities";
const priority = usePriority(project.metadata?.priority);
if (priority?.showFlag) {
  // Show flag with priority.colorClass
}

// ❌ WRONG - Raw priority checks will be confusing
if (project.metadata?.priority === 1) { // This is actually LOW priority!
  // This logic is backwards
}
```

**Files maintaining this abstraction:**
- `convex/todoist/types/priorities.ts` - Canonical mapping 
- `app/src/lib/priorities.ts` - React utilities
- Always import from these files, never hardcode priority logic

```bash
# Test task creation
bunx convex run todoist:actions.createTask '{"content": "Test"}'

# View active tasks  
bunx convex run todoist:queries.getActiveItems
```

## Agentic Development Loop with Todoist MCP

**Recommended validation pattern:**

1. **Make changes** to Convex functions
2. **Local validation**: `bun run typecheck && bun run lint && bun test`
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
- `docs/adding-views-guide.md` - **Quick start guide for adding new views**
- Convex dashboard: `http://localhost:3001`

## Adding New Features

### Adding New Views
**Quick Start**: `docs/adding-views-guide.md` - Step-by-step checklist for adding views

**Complete Examples**:
- Projects View: `docs/projects-view-implementation.md`
- Routines System: `docs/routines-system-implementation.md`
- URL Routing: `docs/url-routing-implementation.md`

**Pattern**: All views follow a consistent 10-step process covering types, definitions, registry, sidebar, routing, counts, and rendering.

## Shadcn Component Installation (CRITICAL)

⚠️ **IMPORTANT**: The `bunx shadcn@latest add` command sometimes reports success but fails to create files.

**Always verify after adding shadcn components:**
```bash
# After running: bunx shadcn@latest add @shadcn/component-name
ls -la src/components/ui/component-name.tsx

# If file doesn't exist, manually create it using the standard shadcn pattern
# or use the Write tool with proper shadcn component structure
```

**Common pattern for manual shadcn component creation:**
1. Check if dependency is installed in package.json
2. If missing, install: `bun add @radix-ui/react-component-name`
3. Create component file manually following shadcn conventions
4. Use "use client" directive for client components
5. Follow standard shadcn export pattern

**Why this happens:**
- Race conditions with Bun's package manager
- Vite dev server caching issues
- File write permissions in some environments

**Prevention:**
- Always verify file creation after `shadcn add`
- Use Glob tool to confirm file exists before importing
- Keep a reference implementation of common components

## Agent Guidelines

- **TodoWrite**: Use for complex multi-step tasks
- **Parallel Operations**: Batch reads, searches, greps
- **Validation Loop**: Always run `bun run typecheck && bun run lint && bun test` after changes
- **Testing**: Every `.ts` file needs corresponding `.test.ts` file
- **MCP Integration**: Use Todoist MCP for bi-directional verification
- **Problem Solving**: Simple solutions > clever abstractions
- **Shadcn Components**: Verify file creation after running shadcn add commands

Focus on maintainable code. Strong data layer enables rapid UI development.