# Todoist Integration

## Overview

Complete Todoist integration providing full synchronization with the master database. Uses three-layer redundancy: API responses, webhooks, and periodic sync.

## Quick Reference

### Core Actions
```typescript
// Create task
api.todoist.actions.createTask({
  content: "New task",
  priority: 2,
  due: { date: "2024-01-01" }
})

// Update task
api.todoist.actions.updateTask({
  todoistId: "123",
  content: "Updated content"
})

// Complete task
api.todoist.actions.completeTask({ todoistId: "123" })
```

### Core Queries
```typescript
// Get active tasks
api.todoist.queries.getActiveItems({ limit: 20 })

// Get projects with metadata
api.todoist.queries.getProjectsWithMetadata()

// Check sync status
api.todoist.queries.getSyncStatus()
```

## Architecture

### Directory Structure
```
todoist/
├── actions/              # API calls using Todoist SDK
├── mutations/            # Internal database operations
│   └── computed/        # Computed property mutations
├── queries/              # Public query functions
│   └── computed/        # Queries with computed properties
├── sync/                 # Sync orchestration
├── types/                # Type definitions
├── helpers/              # Utility functions
└── README.md            # This file
```

### Type System
- **SDK Types** (camelCase): From `@doist/todoist-api-typescript`
- **Database Types** (snake_case): Generated from Convex schema
- **Sync API Types** (snake_case): For bulk operations in `types/syncApi.ts`

## Key Features

### Three-Layer Sync
1. **API Response Storage**: Immediate write after successful API calls
2. **Webhook Confirmation**: Real-time updates via Todoist webhooks
3. **Periodic Sync**: Hourly cron job catches missed updates

### Computed Properties System
Extracts metadata from special tasks (labeled `project-metadata` or starting with `*`) and pre-populates it for efficient querying.

```typescript
// Get projects with computed properties
const projects = await api.todoist.queries.getProjectsWithMetadata();
// Returns: { ...project, metadata: {...}, stats: {...}, computed: {...} }
```

### Version Control
Every mutation checks sync versions to prevent data overwrites:
```typescript
if (existing && existing.sync_version >= item.sync_version) {
  return; // Skip if we have newer data
}
```

## Development Patterns

### Adding New Features
1. Define types in `types/syncApi.ts` if needed
2. Create action in `actions/` using SDK
3. Create/update mutations in `mutations/`
4. Export from barrel files

### Testing
Uses simplified testing approach due to Bun/convex-test compatibility:
```typescript
// Test business logic directly
test("transforms API response to database format", () => {
  const apiResponse = createMockTodoistItem();
  const dbFormat = transformToDbFormat(apiResponse);
  expect(dbFormat.todoist_id).toBe(apiResponse.id);
});
```

## Important Notes

- **ONLY USE TODOIST API v1**: `https://api.todoist.com/api/v1/*`
- **NEVER use deprecated APIs**: v2, v9 are deprecated
- **PREFER SDK methods** over raw API calls
- **MAINTAIN three-layer sync redundancy**
- **TEST webhook signatures** in production

## Common Operations

### Debugging Sync Issues
```bash
# Check sync status
bunx convex run todoist:queries.getSyncStatus

# View recent errors
bunx convex run todoist:monitoring.getRecentErrors

# Force manual sync
bunx convex run todoist:sync.performIncrementalSync
```

### Manual Data Operations
```bash
# Clear all data (development only)
bunx convex run todoist:actions.clearAllData

# Run initial sync
bunx convex run todoist:sync.runInitialSync

# Refresh project metadata
bunx convex run todoist:actions.refreshProjectMetadata
```

For detailed architecture, error handling, and troubleshooting information, see the main project documentation.