# API Reference

## Overview

This document describes all Convex functions available in the Personal Master Database system.

## Actions

Actions handle external API calls and long-running operations.

### `todoist:actions:createTask`

Creates a new task in Todoist and stores it immediately in Convex.

```typescript
args: {
  content: string,
  projectId?: string,
  priority?: number,
  due?: { date: string },
  labels?: string[]
}

returns: {
  id: string,
  content: string,
  project_id: string,
  // ... full task object
}
```

**Example:**
```bash
npx convex run todoist:actions:createTask '{
  "content": "Buy groceries",
  "priority": 4,
  "due": {"date": "2024-01-20"}
}'
```

### `todoist:actions:updateTask`

Updates an existing task.

```typescript
args: {
  todoistId: string,
  updates: {
    content?: string,
    priority?: number,
    due?: { date: string }
  }
}
```

### `todoist:actions:completeTask`

Marks a task as completed.

```typescript
args: {
  todoistId: string
}
```

### `todoist:actions:performIncrementalSync`

Runs incremental sync using stored sync token.

```typescript
args: {} // No arguments needed

returns: {
  itemsSynced: number,
  syncToken: string
}
```

### `todoist:actions:runInitialSync`

Performs full sync of all Todoist data.

```typescript
args: {} // No arguments needed

returns: {
  projectsCount: number,
  tasksCount: number,
  syncToken: string
}
```

## Queries

Queries read data from the Convex database.

### `todoist:queries:getActiveTasks`

Returns all active (non-completed, non-deleted) tasks.

```typescript
args: {
  projectId?: string  // Optional filter by project
}

returns: Task[]
```

### `todoist:queries:getProjects`

Returns all active projects.

```typescript
args: {}

returns: Project[]
```

### `todoist:queries:getTaskWithProject`

Returns a task with its associated project data.

```typescript
args: {
  taskId: Id<"todoist_tasks">
}

returns: {
  ...Task,
  project?: Project
}
```

### `todoist:queries:getProjectWithStats`

Returns project with task statistics.

```typescript
args: {
  projectId: string
}

returns: {
  ...Project,
  stats: {
    total: number,
    completed: number,
    active: number
  }
}
```

### `todoist:queries:getSyncHealth`

Returns current sync status and recent errors.

```typescript
args: {}

returns: {
  lastSync?: string,
  status: "idle" | "syncing" | "error",
  errorCount: number,
  recentErrors: WebhookEvent[]
}
```

## Mutations

Internal mutations that modify the database.

### `todoist:mutations:upsertTask`

Updates or inserts a task (internal use only).

```typescript
args: {
  task: TodoistTask
}
```

### `todoist:mutations:upsertProject`

Updates or inserts a project (internal use only).

```typescript
args: {
  project: TodoistProject
}
```

### `todoist:mutations:updateSyncToken`

Updates the sync token after successful sync.

```typescript
args: {
  token: string
}
```

## HTTP Endpoints

### `POST /todoist/webhook`

Receives webhook events from Todoist.

**Headers:**
- `X-Todoist-Hmac-SHA256`: Signature for verification

**Body:**
```json
{
  "event_name": "item:added",
  "event_data": {
    "id": "xxx",
    "content": "Task content"
  }
}
```

## Data Types

### Task

```typescript
interface Task {
  _id: Id<"todoist_tasks">,
  todoist_id: string,
  content: string,
  description?: string,
  project_id?: string,
  project_name?: string,  // Denormalized
  section_id?: string,
  section_name?: string,  // Denormalized
  parent_id?: string,
  order: number,
  priority: number,
  due?: {
    date: string,
    string: string,
    datetime?: string,
    timezone?: string,
    is_recurring: boolean
  },
  deadline?: {
    date: string,
    lang: string
  },
  labels: string[],
  is_completed: boolean,
  completed_at?: string,
  created_at: string,
  updated_at: string,
  is_deleted: boolean,
  sync_version: number
}
```

### Project

```typescript
interface Project {
  _id: Id<"todoist_projects">,
  todoist_id: string,
  name: string,
  description?: string,
  color: string,
  parent_id?: string,
  child_order: number,
  workspace_id?: number,
  is_deleted: boolean,
  is_archived: boolean,
  is_favorite: boolean,
  view_style: string,
  inbox_project: boolean,
  sync_version: number
}
```

## Error Handling

All functions may throw these errors:

- `TODOIST_API_TOKEN not configured`: Missing API token
- `Todoist API error: {status}`: API request failed
- `Invalid signature`: Webhook verification failed
- `Sync in progress`: Another sync is running

## Rate Limits

- Todoist API: 450 requests per 15 minutes
- Convex functions: No hard limits
- Webhooks: Process within 10 seconds

## Best Practices

1. **Use Actions for API calls**: Never call external APIs from mutations
2. **Check sync_version**: Prevent overwriting newer data
3. **Handle errors gracefully**: All operations should have error handling
4. **Use indexes**: Query by indexed fields for performance
5. **Batch operations**: Process multiple items together when possible