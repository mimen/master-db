# Todoist Integration Architecture

This directory contains a complete Todoist integration for the Convex Master Database system. The integration provides full synchronization with Todoist while maintaining data integrity through multiple redundancy layers.

## Architecture Overview

### Three-Layer Sync Architecture
1. **API Response Storage** - Immediate write after successful API calls
2. **Webhook Confirmation** - Real-time updates via Todoist webhooks
3. **Periodic Sync** - Hourly cron job catches any missed updates

### Type System
The integration uses three distinct type systems:
1. **SDK Types** (camelCase) - From `@doist/todoist-api-typescript` for API interactions
2. **Database Types** (snake_case) - Generated from Convex schema definitions
3. **Sync API Types** (snake_case) - For bulk sync operations in `types/syncApi.ts`

## Directory Structure

```
todoist/
├── actions/              # Public API actions using Todoist SDK
├── mutations/            # Internal database mutations
├── queries/              # Public query functions
├── sync/                 # Sync orchestration
├── types/                # Type definitions
├── publicActions.ts      # Barrel exports for actions
├── publicQueries.ts      # Barrel exports for queries
└── CLAUDE.md            # This file
```

## Key Design Patterns

### 1. Action Pattern
All Todoist API calls go through actions that:
- Use the official Todoist SDK
- Return standardized `ActionResponse<T>` types
- Update Convex database on success
- Handle errors gracefully

```typescript
// Example: actions/createTask.ts
const task = await client.addTask(taskArgs);
await ctx.runMutation(internal.todoist.mutations.upsertItem, { 
  item: convertToSyncFormat(task) 
});
return { success: true, data: task };
```

### 2. Mutation Pattern
Database mutations ensure data integrity:
- Type-safe with Convex schemas
- Version checking prevents overwrites
- Soft deletion (never hard delete)
- Idempotent operations

```typescript
// Example: mutations/upsertItem.ts
if (existing && existing.sync_version >= item.sync_version) {
  return; // Skip if we have newer data
}
```

### 3. Query Pattern
Queries provide filtered, denormalized data:
- Real-time subscriptions via Convex
- Computed fields (e.g., item counts)
- Efficient indexing for performance

## API Usage

### Actions (Write Operations)
```typescript
// Create a task
api.todoist.actions.createTask({
  content: "New task",
  priority: 2,
  due: { date: "2024-01-01" }
})

// Update a task
api.todoist.actions.updateTask({
  todoistId: "123",
  content: "Updated content"
})

// Complete a task
api.todoist.actions.completeTask({ todoistId: "123" })
```

### Queries (Read Operations)
```typescript
// Get active tasks
api.todoist.queries.getActiveItems({ limit: 20 })

// Get projects with counts
api.todoist.queries.getProjectWithItemCount({ todoistId: "proj-123" })

// Get sync status
api.todoist.queries.getSyncStatus()
```

## Sync Mechanisms

### Initial Sync
Fetches all data from Todoist:
```typescript
internal.todoist.sync.runInitialSync()
```

### Incremental Sync
Updates changes since last sync:
```typescript
internal.todoist.sync.performIncrementalSync()
```

### Webhook Handler
Processes real-time updates:
- Validates webhook signatures
- Updates only changed items
- Maintains sync version tracking

## Type Safety

### Database Schema
Defined in `convex/schema/todoist/`:
- Fully typed with Convex validators
- No `v.any()` types
- Generated TypeScript types via `Doc<"table_name">`

### Sync API Types
Centralized in `types/syncApi.ts`:
- Matches Todoist Sync API structure
- Reusable across all sync operations
- Type inference helpers included

### Testing Types
Use `FunctionArgs` for type extraction:
```typescript
type CreateTaskArgs = FunctionArgs<typeof api.todoist.actions.createTask>;
type TodoistItem = Doc<"todoist_items">;
```

## Best Practices

### 1. Always Use SDK for Mutations
The official SDK handles rate limiting and provides type safety:
```typescript
const client = getTodoistClient();
await client.updateTask(id, updates);
```

### 2. Sync API for Bulk Operations
Use raw fetch only for sync endpoints (SDK doesn't support):
```typescript
fetch("https://api.todoist.com/api/v1/sync", {
  // ... sync operations
});
```

### 3. Version Control
Every mutation checks versions to prevent data loss:
```typescript
const currentVersion = Date.now();
if (existing.sync_version < currentVersion) {
  // Update only if newer
}
```

### 4. Error Handling
Standardized error responses:
```typescript
return {
  success: false,
  error: "User-friendly message",
  code: "SPECIFIC_ERROR_CODE"
};
```

## Common Operations

### Adding New Features
1. Define types in `types/syncApi.ts` if needed
2. Create action in `actions/` using SDK
3. Create/update mutations in `mutations/`
4. Export from `publicActions.ts` or `publicQueries.ts`

### Debugging Sync Issues
```typescript
// Check sync status
api.todoist.queries.getSyncStatus()

// View sync state
internal.todoist.internal.getSyncState()

// Force sync
internal.todoist.sync.performIncrementalSync()
```

### Type Updates
1. Update schema in `convex/schema/todoist/`
2. Run `npx convex dev` to generate types
3. Update sync types in `types/syncApi.ts`

## Important Notes

- **NEVER** use deprecated APIs (v2, v9)
- **ALWAYS** use API v1: `https://api.todoist.com/api/v1/*`
- **PREFER** SDK methods over raw API calls
- **MAINTAIN** three-layer sync redundancy
- **TEST** webhook signatures in production