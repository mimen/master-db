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

## Webhook Setup

### Configuration

**1. Set Environment Variables**
```bash
# Development (.env.local)
TODOIST_WEBHOOK_SECRET=your_todoist_app_client_secret_here

# Production (Convex Dashboard)
# Add TODOIST_WEBHOOK_SECRET in Settings > Environment Variables
```

**2. Get Your Webhook Secret**
- Visit the [Todoist App Management Console](https://developer.todoist.com/appconsole.html)
- Copy your app's **client_secret** (this is your webhook secret)

**3. Configure Webhook URL in Todoist**
- In the App Management Console, set your webhook URL:
  ```
  https://your-convex-deployment.convex.cloud/todoist/webhook
  ```
- Get your Convex URL from the dashboard or `.env.local` (CONVEX_URL)

**4. Complete OAuth Flow for Personal Use**
Todoist webhooks don't fire by default for the app creator. To activate:

1. Build authorization URL (replace YOUR_CLIENT_ID):
   ```
   https://todoist.com/oauth/authorize?client_id=YOUR_CLIENT_ID&scope=data:read_write&state=secretstring
   ```
2. Open in browser, authorize the app
3. Capture the `code` from the redirect URL
4. Exchange code for token using POST request (via Postman/curl):
   ```bash
   curl -X POST https://todoist.com/oauth/access_token \
     -H "Content-Type: application/json" \
     -d '{"client_id":"YOUR_CLIENT_ID","client_secret":"YOUR_CLIENT_SECRET","code":"CAPTURED_CODE"}'
   ```

### Supported Events

The webhook handler processes these Todoist events:

**Items (Tasks)**
- `item:added` - Task created
- `item:updated` - Task modified
- `item:deleted` - Task deleted (soft delete)
- `item:completed` - Task completed
- `item:uncompleted` - Task uncompleted

**Projects**
- `project:added` - Project created
- `project:updated` - Project modified
- `project:deleted` - Project deleted (soft delete)
- `project:archived` - Project archived (soft delete)
- `project:unarchived` - Project unarchived

**Labels**
- `label:added` - Label created
- `label:updated` - Label modified
- `label:deleted` - Label deleted (soft delete)

### How It Works

1. **Todoist sends webhook** → POST to `/todoist/webhook`
2. **Signature verification** → Validates HMAC-SHA256 signature
3. **Idempotency check** → Skips duplicate deliveries using delivery_id
4. **Route to mutations** → Calls existing upsert mutations
5. **Metadata extraction** → Triggers for item events
6. **Event logging** → Records in `todoist_webhook_events` table
7. **Return 200 OK** → Prevents retry from Todoist

### Monitoring Webhooks

```bash
# View recent webhook events
bunx convex run todoist:queries.getRecentWebhookEvents

# Check for failed webhooks
bunx convex run todoist:queries.getFailedWebhookEvents

# View events for specific entity
bunx convex run todoist:queries.getWebhookEventsByEntity '{"entityId": "task_id"}'
```

### Webhook Reliability

- **Retry Logic**: Todoist retries failed deliveries up to 3 times (15-minute intervals)
- **Idempotency**: Safe to process same event multiple times
- **Version Checking**: Existing mutations prevent data overwrites
- **Fallback Sync**: Cron job catches any missed updates

### Debugging

**Check webhook delivery:**
```bash
# In Todoist App Management Console
# View webhook delivery logs for your app
```

**Common issues:**
- **401 Invalid signature**: Check TODOIST_WEBHOOK_SECRET matches client_secret
- **500 Internal error**: Check Convex logs for errors
- **No webhooks firing**: Complete OAuth flow for personal use
- **Duplicate processing**: Idempotency check should prevent this

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