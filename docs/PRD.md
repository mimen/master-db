# Personal Master Database System - Product Requirements Document

## Executive Summary

A single-user Convex-based system that serves as a centralized data hub, starting with Todoist integration. The system maintains real-time synchronization through webhooks with hourly periodic sync as backup, using a clear data flow: UI → Todoist API → Webhook → Convex → UI.

## System Architecture

### Core Principles
1. **External services are the source of truth** - Convex mirrors and caches
2. **Denormalized storage** - Optimize for query simplicity over storage efficiency
3. **Simple error handling** - Block operations when APIs unavailable
4. **Incremental syncing** - Use Todoist Sync API tokens to minimize data transfer
5. **Single-user design** - No multi-tenancy complexity
6. **Redundant sync paths** - Multiple sync mechanisms ensure reliability
7. **Actions for external calls** - Use Convex actions for all API calls

### Data Flow
```
User Action → UI → Convex Action → Todoist API → Store in Convex → UI Update (immediate)
                                         ↓
                              Todoist Webhook → Convex (milliseconds later)
                                         ↑
                              Hourly Sync (backup for missed updates)
```

**Three-Layer Redundancy**:
1. **Immediate**: API response stored directly in Convex
2. **Real-time**: Webhook confirms/updates the change  
3. **Backup**: Hourly sync catches anything missed

### Convex Development Model

1. **Local Development**: `npx convex dev` runs a complete Convex backend locally with:
   - Local database (SQLite-based)
   - Hot reloading of functions
   - Separate from production data
   - Dashboard at `https://localhost:3001`

2. **Production Deployment**: `npx convex deploy` pushes to Convex's managed cloud:
   - Global edge deployment
   - Automatic scaling and replication
   - Built-in monitoring and backups
   - Production dashboard at `dashboard.convex.dev`

3. **Environment Variables**:
   - Development: `.env.local` file
   - Production: Set in Convex dashboard
   - Completely isolated between environments

## Phase 1: Foundation & Todoist Integration

### 1.1 Project Setup

#### Development Environment
```bash
# Initialize Convex project
npx create-convex-app personal-master-db
cd personal-master-db

# Install dependencies
bun add axios zod dotenv

# Development tools
bun add -D @types/node ngrok
```

#### Environment Configuration
Create `.env.local`:
```env
# Todoist API
TODOIST_API_TOKEN=your_api_token_here
TODOIST_WEBHOOK_SECRET=generate_random_secret

# Development
CONVEX_DEPLOYMENT=dev
```

### 1.2 Database Schema

#### Core Tables

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Todoist Items (tasks)
  todoist_items: defineTable({
    // Todoist fields
    todoist_id: v.string(),
    content: v.string(),
    description: v.optional(v.string()),
    project_id: v.optional(v.string()),
    project_name: v.optional(v.string()), // Denormalized
    section_id: v.optional(v.string()),
    section_name: v.optional(v.string()), // Denormalized
    parent_id: v.optional(v.string()),
    child_order: v.number(),
    priority: v.number(),
    due: v.optional(v.object({
      date: v.string(),
      string: v.string(),
      datetime: v.optional(v.string()),
      timezone: v.optional(v.string()),
      is_recurring: v.boolean(),
    })),
    deadline: v.optional(v.object({
      date: v.string(),
      lang: v.string(),
    })),
    labels: v.array(v.string()),
    assignee_id: v.optional(v.string()),
    assigner_id: v.optional(v.string()),
    comment_count: v.number(),
    // computed from checked field
    added_at: v.string(),
    checked: v.number(), // 0 = unchecked, 1 = checked
    
    // Sync metadata
    is_deleted: v.boolean(),
    last_synced: v.string(),
    sync_version: v.number(),
  })
    .index("by_todoist_id", ["todoist_id"])
    .index("by_project", ["project_id"])
    .index("by_completed", ["is_completed"])
    .index("by_updated", ["updated_at"])
    .index("active_items", ["is_deleted", "checked"]),

  // Todoist Projects
  todoist_projects: defineTable({
    todoist_id: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    color: v.string(),
    parent_id: v.optional(v.string()),
    child_order: v.number(),
    workspace_id: v.optional(v.number()),
    is_invite_only: v.boolean(),
    status: v.string(), // IN_PROGRESS, etc.
    collaborator_role_default: v.optional(v.string()),
    is_deleted: v.boolean(),
    is_archived: v.boolean(),
    is_favorite: v.boolean(),
    is_frozen: v.boolean(),
    view_style: v.string(),
    inbox_project: v.boolean(),
    folder_id: v.optional(v.string()),
    role: v.optional(v.string()), // User's role in project
    
    // Sync metadata
    last_synced: v.string(),
    sync_version: v.number(),
  })
    .index("by_todoist_id", ["todoist_id"])
    .index("active_projects", ["is_deleted", "is_archived"]),

  // Todoist Sections
  todoist_sections: defineTable({
    todoist_id: v.string(),
    name: v.string(),
    project_id: v.string(),
    project_name: v.optional(v.string()), // Denormalized
    section_order: v.number(),
    is_deleted: v.boolean(),
    is_archived: v.boolean(),
    
    // Sync metadata
    last_synced: v.string(),
    sync_version: v.number(),
  })
    .index("by_todoist_id", ["todoist_id"])
    .index("by_project", ["project_id"])
    .index("active_sections", ["is_deleted", "is_archived"]),

  // Todoist Labels
  todoist_labels: defineTable({
    todoist_id: v.string(),
    name: v.string(),
    color: v.string(),
    item_order: v.number(),
    is_deleted: v.boolean(),
    is_favorite: v.boolean(),
    
    // Sync metadata
    last_synced: v.string(),
    sync_version: v.number(),
  })
    .index("by_todoist_id", ["todoist_id"])
    .index("by_name", ["name"])
    .index("active_labels", ["is_deleted"]),

  // Task Notes (Comments)
  todoist_notes: defineTable({
    todoist_id: v.string(),
    task_id: v.string(),
    project_id: v.optional(v.string()),
    content: v.string(),
    posted_uid: v.string(),
    is_deleted: v.boolean(),
    posted_at: v.string(),
    
    // Sync metadata
    last_synced: v.string(),
    sync_version: v.number(),
  })
    .index("by_todoist_id", ["todoist_id"])
    .index("by_task", ["task_id"])
    .index("active_notes", ["is_deleted"]),

  // Reminders
  todoist_reminders: defineTable({
    todoist_id: v.string(),
    task_id: v.string(),
    type: v.string(), // "absolute", "relative"
    due: v.object({
      date: v.string(),
      timezone: v.optional(v.string()),
      is_recurring: v.boolean(),
    }),
    minute_offset: v.optional(v.number()),
    is_deleted: v.boolean(),
    
    // Sync metadata
    last_synced: v.string(),
    sync_version: v.number(),
  })
    .index("by_todoist_id", ["todoist_id"])
    .index("by_task", ["task_id"])
    .index("active_reminders", ["is_deleted"]),

  // Sync State
  sync_state: defineTable({
    service: v.string(),
    last_sync_token: v.optional(v.string()),
    last_full_sync: v.string(),
    last_incremental_sync: v.optional(v.string()),
    sync_status: v.union(
      v.literal("idle"),
      v.literal("syncing"),
      v.literal("error")
    ),
    error_message: v.optional(v.string()),
    error_count: v.number(),
  })
    .index("by_service", ["service"]),

  // Webhook Events
  webhook_events: defineTable({
    service: v.string(),
    event_id: v.string(),
    event_type: v.string(),
    payload: v.any(),
    received_at: v.string(),
    processed: v.boolean(),
    error: v.optional(v.string()),
  })
    .index("by_service_processed", ["service", "processed"])
    .index("by_event_id", ["event_id"]),
});
```

### 1.3 Todoist Integration Layer

#### API Client
```typescript
// convex/todoist/lib/client.ts
export class TodoistClient {
  private syncUrl = "https://api.todoist.com/api/v1";
  private token: string;

  constructor(token: string) {
    if (!token) {
      throw new Error("TODOIST_API_TOKEN not configured");
    }
    this.token = token;
  }

  async request(url: string, options: RequestInit = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Command-based operations
  executeCommands(commands: any[]) {
    return this.request(`${this.syncUrl}/sync`, {
      method: "POST",
      body: JSON.stringify({ commands }),
    });
  }

  // Sync API methods
  sync(syncToken: string = "*") {
    return this.request(`${this.syncUrl}/sync`, {
      method: "POST",
      body: JSON.stringify({
        sync_token: syncToken,
        resource_types: ["projects", "items", "labels", "sections", "notes", "reminders"],
      }),
    });
  }
}
```

#### Sync Logic
```typescript
// convex/todoist/sync.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Actions for external API calls
// convex/todoist/actions.ts
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { TodoistClient } from "./lib/client";

// Create task via Todoist API v1 commands
export const createTask = action({
  args: {
    content: v.string(),
    projectId: v.optional(v.string()),
    priority: v.optional(v.number()),
    due: v.optional(v.object({ date: v.string() })),
    labels: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const client = new TodoistClient(process.env.TODOIST_API_TOKEN!);
    const tempId = crypto.randomUUID();
    const uuid = crypto.randomUUID();
    
    // 1. Call Todoist API with command
    const response = await client.executeCommands([{
      type: "item_add",
      temp_id: tempId,
      uuid: uuid,
      args: {
        content: args.content,
        project_id: args.projectId,
        priority: args.priority || 1,
        due: args.due ? { date: args.due.date } : undefined,
        labels: args.labels || [],
      },
    }]);

    // 2. Get the real ID from temp_id_mapping
    const realId = response.temp_id_mapping[tempId];
    const task = {
      id: realId,
      content: args.content,
      project_id: args.projectId,
      // ... other fields will be populated by the sync
    };

    // 3. Store in Convex IMMEDIATELY (don't wait for webhook)
    await ctx.runMutation(internal.todoist.mutations.upsertItemFromApi, {
      item: task,
    });

    // 4. Return to UI for immediate update
    return task;
    
    // 5. Webhook will fire milliseconds later as confirmation
    // 6. Hourly sync will catch this if both above fail
  },
});

// Complete task via Todoist API v1 commands
export const completeTask = action({
  args: { todoistId: v.string() },
  handler: async (ctx, args) => {
    const client = new TodoistClient(process.env.TODOIST_API_TOKEN!);
    const uuid = crypto.randomUUID();
    
    await client.executeCommands([{
      type: "item_complete",
      uuid: uuid,
      args: {
        id: args.todoistId,
      },
    }]);
    
    await ctx.runMutation(internal.todoist.mutations.markItemCompleted, {
      todoistId: args.todoistId,
    });
  },
});

// Perform incremental sync
export const performIncrementalSync = action({
  handler: async (ctx) => {
    const syncState = await ctx.runQuery(internal.todoist.queries.getSyncState);
    const client = new TodoistClient(process.env.TODOIST_API_TOKEN!);
    
    await ctx.runMutation(internal.todoist.mutations.setSyncStatus, {
      status: "syncing",
    });

    try {
      const syncData = await client.sync(syncState?.last_sync_token || "*");

      // Process in batches for efficiency
      if (syncData.projects?.length > 0) {
        await ctx.runMutation(internal.todoist.mutations.upsertProjects, {
          projects: syncData.projects,
        });
      }

      if (syncData.items?.length > 0) {
        const chunks = chunkArray(syncData.items, 100);
        for (const chunk of chunks) {
          await ctx.runMutation(internal.todoist.mutations.upsertItems, {
            items: chunk,
          });
        }
      }

      // Update sync token - ONLY the sync API updates this
      await ctx.runMutation(internal.todoist.mutations.updateSyncToken, {
        token: syncData.sync_token,
      });
    } catch (error) {
      await ctx.runMutation(internal.todoist.mutations.setSyncError, {
        error: error.message,
      });
      throw error;
    }
  },
});

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Internal mutations for database operations
// convex/todoist/mutations.ts
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Get current sync state
export const getSyncState = internalQuery({
  handler: async (ctx) => {
    return ctx.db
      .query("sync_state")
      .withIndex("by_service", q => q.eq("service", "todoist"))
      .first();
  },
});

// Incremental sync using Todoist Sync API
export const performIncrementalSync = internalMutation({
  handler: async (ctx) => {
    // Get current sync state
    const syncState = await ctx.db
      .query("sync_state")
      .withIndex("by_service", q => q.eq("service", "todoist"))
      .first();

    // Update sync status
    if (syncState) {
      await ctx.db.patch(syncState._id, { 
        sync_status: "syncing",
        error_message: undefined,
      });
    }

    try {
      // Prepare sync request
      const syncToken = syncState?.last_sync_token || "*";
      const resourceTypes = [
        "projects", 
        "items", 
        "sections", 
        "labels", 
        "notes", 
        "reminders"
      ];
      
      const syncData = await todoistRequest(ctx, "/sync", {
        method: "POST",
        body: JSON.stringify({
          sync_token: syncToken,
          resource_types: resourceTypes,
        }),
      });

      // Process projects
      if (syncData.projects) {
        for (const project of syncData.projects) {
          await upsertProject(ctx, project);
        }
      }

      // Process sections
      if (syncData.sections) {
        for (const section of syncData.sections) {
          await upsertSection(ctx, section);
        }
      }

      // Process labels
      if (syncData.labels) {
        for (const label of syncData.labels) {
          await upsertLabel(ctx, label);
        }
      }

      // Process tasks (items)
      if (syncData.items) {
        for (const item of syncData.items) {
          await upsertItem(ctx, item);
        }
      }

      // Process notes
      if (syncData.notes) {
        for (const note of syncData.notes) {
          await upsertNote(ctx, note);
        }
      }

      // Process reminders
      if (syncData.reminders) {
        for (const reminder of syncData.reminders) {
          await upsertReminder(ctx, reminder);
        }
      }

      // Store full_sync flag for diagnostics
      const isFullSync = syncData.full_sync || false;

      // Update sync state
      await ctx.db.patch(syncState!._id, {
        last_sync_token: syncData.sync_token,
        last_incremental_sync: new Date().toISOString(),
        sync_status: "idle",
        error_count: 0,
      });

    } catch (error) {
      // Update error state
      if (syncState) {
        await ctx.db.patch(syncState._id, {
          sync_status: "error",
          error_message: error.message,
          error_count: (syncState.error_count || 0) + 1,
        });
      }
      throw error;
    }
  },
});

// Idempotent upsert functions with sync_version checking
export const upsertItemFromApi = internalMutation({
  args: { item: v.any() },
  handler: async (ctx, { item }) => {
    await upsertItem(ctx, item);
  },
});

export const upsertItems = internalMutation({
  args: { items: v.array(v.any()) },
  handler: async (ctx, { items }) => {
    for (const item of items) {
      await upsertItem(ctx, item);
    }
  },
});

export const upsertProjects = internalMutation({
  args: { projects: v.array(v.any()) },
  handler: async (ctx, { projects }) => {
    for (const project of projects) {
      await upsertProject(ctx, project);
    }
  },
});

// Helper functions with idempotency
async function upsertProject(ctx: any, project: any) {
  const existing = await ctx.db
    .query("todoist_projects")
    .withIndex("by_todoist_id", q => q.eq("todoist_id", project.id))
    .first();

  // Skip if we already have this version or newer
  if (existing && existing.sync_version >= project.sync_version) {
    return;
  }

  const projectData = {
    todoist_id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    parent_id: project.parent_id,
    child_order: project.child_order,
    workspace_id: project.workspace_id,
    is_invite_only: project.is_invite_only || false,
    status: project.status || "IN_PROGRESS",
    collaborator_role_default: project.collaborator_role_default,
    is_deleted: project.is_deleted || false,
    is_archived: project.is_archived || false,
    is_favorite: project.is_favorite || false,
    is_frozen: project.is_frozen || false,
    view_style: project.view_style || "list",
    inbox_project: project.inbox_project || false,
    folder_id: project.folder_id,
    role: project.role,
    last_synced: new Date().toISOString(),
    sync_version: project.sync_version || 0,
  };

  if (existing) {
    await ctx.db.patch(existing._id, projectData);
  } else {
    await ctx.db.insert("todoist_projects", projectData);
  }
}

async function upsertItem(ctx: any, item: any) {
  const existing = await ctx.db
    .query("todoist_items")
    .withIndex("by_todoist_id", q => q.eq("todoist_id", item.id))
    .first();

  // Skip if we already have this version or newer
  if (existing && existing.sync_version >= item.v) {
    return;
  }

  // Get project name for denormalization
  let projectName = undefined;
  if (item.project_id) {
    const project = await ctx.db
      .query("todoist_projects")
      .withIndex("by_todoist_id", q => q.eq("todoist_id", item.project_id))
      .first();
    projectName = project?.name;
  }

  // Get section name for denormalization
  let sectionName = undefined;
  if (item.section_id) {
    const section = await ctx.db
      .query("todoist_sections")
      .withIndex("by_todoist_id", q => q.eq("todoist_id", item.section_id))
      .first();
    sectionName = section?.name;
  }

  const itemData = {
    todoist_id: item.id,
    content: item.content,
    description: item.description,
    project_id: item.project_id,
    project_name: projectName,
    section_id: item.section_id,
    section_name: sectionName,
    parent_id: item.parent_id,
    child_order: item.child_order,
    priority: item.priority,
    due: item.due,
    deadline: item.deadline,
    labels: item.labels || [],
    assignee_id: item.assigned_by_uid,
    assigner_id: item.added_by_uid,
    comment_count: item.comment_count || 0,
    checked: item.checked || 0,
    added_at: item.added_at,
    is_deleted: item.is_deleted || 0,
    last_synced: new Date().toISOString(),
    sync_version: item.v || 0,
  };

  if (existing) {
    await ctx.db.patch(existing._id, itemData);
  } else {
    await ctx.db.insert("todoist_items", itemData);
  }
}

// Update sync token (only from Sync API)
export const updateSyncToken = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const syncState = await ctx.db
      .query("sync_state")
      .withIndex("by_service", q => q.eq("service", "todoist"))
      .first();
      
    if (syncState) {
      await ctx.db.patch(syncState._id, {
        last_sync_token: token,
        last_incremental_sync: new Date().toISOString(),
        sync_status: "idle",
        error_count: 0,
      });
    }
  },
});

// Cron job for hourly sync
export const cronJobSync = cronJobs.interval(
  "todoist hourly sync",
  { hours: 1 },
  internal.todoist.actions.performIncrementalSync  // Calls action, not mutation
);
```

#### Webhook Handler
```typescript
// convex/http.ts - HTTP router for all endpoints
import { httpRouter } from "convex/server";
import { handleTodoistWebhook } from "./todoist/webhook";

const http = httpRouter();

http.route({
  path: "/todoist/webhook",
  method: "POST",
  handler: handleTodoistWebhook,
});

export default http;

// convex/todoist/webhook.ts
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import crypto from "crypto";

export const handleTodoistWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.TODOIST_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("Webhook secret not configured", { status: 500 });
  }

  // Verify webhook signature
  const body = await request.text();
  const signature = request.headers.get("X-Todoist-Hmac-SHA256");
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64");

  if (signature !== expectedSignature) {
    return new Response("Invalid signature", { status: 401 });
  }

  // Parse and store event
  const event = JSON.parse(body);
  
  await ctx.runMutation(internal.todoist.mutations.storeWebhookEvent, {
    event_id: event.event_id,
    event_type: event.event_name,
    payload: event.event_data,
  });

  // Process event asynchronously
  ctx.scheduler.runAfter(0, internal.todoist.mutations.processWebhookEvent, {
    event_id: event.event_id,
  });

  return new Response("OK", { status: 200 });
});

export const storeWebhookEvent = mutation({
  args: {
    event_id: v.string(),
    event_type: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    // Check for duplicate
    const existing = await ctx.db
      .query("webhook_events")
      .withIndex("by_event_id", q => q.eq("event_id", args.event_id))
      .first();

    if (!existing) {
      await ctx.db.insert("webhook_events", {
        service: "todoist",
        event_id: args.event_id,
        event_type: args.event_type,
        payload: args.payload,
        received_at: new Date().toISOString(),
        processed: false,
      });
    }
  },
});

export const processWebhookEvent = mutation({
  args: { event_id: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("webhook_events")
      .withIndex("by_event_id", q => q.eq("event_id", args.event_id))
      .first();

    if (!event || event.processed) return;

    try {
      // Process based on event type
      switch (event.event_type) {
        case "item:added":
        case "item:updated":
          await upsertItem(ctx, event.payload);
          break;
        case "item:deleted":
          await softDeleteItem(ctx, event.payload.id);
          break;
        case "project:added":
        case "project:updated":
          await upsertProject(ctx, event.payload);
          break;
        case "project:deleted":
          await softDeleteProject(ctx, event.payload.id);
          break;
      }

      // Mark as processed
      await ctx.db.patch(event._id, { processed: true });
    } catch (error) {
      await ctx.db.patch(event._id, { 
        processed: true, 
        error: error.message 
      });
    }
  },
});
```

### 1.4 API Layer for UI

```typescript
// convex/todoist/api.ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get active items
export const getActiveItems = query({
  args: {
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("todoist_items")
      .withIndex("active_items", q => 
        q.eq("is_deleted", 0).eq("checked", 0)
      );

    if (args.projectId) {
      query = query.filter(q => q.eq(q.field("project_id"), args.projectId));
    }

    return query.collect();
  },
});

// Get all projects
export const getProjects = query({
  handler: async (ctx) => {
    return ctx.db
      .query("todoist_projects")
      .withIndex("active_projects", q => 
        q.eq("is_deleted", false).eq("is_archived", false)
      )
      .collect();
  },
});

// Note: These are now queries and reference actions for external API calls
// UI should call actions, not mutations, for Todoist operations
```

## Phase 2: Testing & Monitoring

### 2.1 Testing Strategy

#### Unit Tests
```typescript
// convex/todoist/sync.test.ts
import { expect, test } from "vitest";
import { upsertItem, upsertProject } from "./sync";

test("upsertItem creates new item", async () => {
  // Test implementation
});

test("upsertItem updates existing item", async () => {
  // Test implementation
});

test("webhook signature verification", async () => {
  // Test implementation
});
```

#### Integration Tests
- Test full sync flow with mock Todoist API
- Test webhook processing with sample events
- Test error recovery and retry logic

### 2.2 Monitoring & Observability

```typescript
// convex/monitoring.ts
import { query } from "./_generated/server";

export const getSyncHealth = query({
  handler: async (ctx) => {
    const syncState = await ctx.db
      .query("sync_state")
      .withIndex("by_service", q => q.eq("service", "todoist"))
      .first();

    const recentErrors = await ctx.db
      .query("webhook_events")
      .withIndex("by_service_processed", q => 
        q.eq("service", "todoist").eq("processed", true)
      )
      .filter(q => q.neq(q.field("error"), undefined))
      .take(10);

    return {
      lastSync: syncState?.last_incremental_sync,
      status: syncState?.sync_status,
      errorCount: syncState?.error_count || 0,
      recentErrors,
    };
  },
});
```

## Additional Sync Functions

```typescript
// Helper function for sections
async function upsertSection(ctx: any, section: any) {
  const existing = await ctx.db
    .query("todoist_sections")
    .withIndex("by_todoist_id", q => q.eq("todoist_id", section.id))
    .first();

  if (existing && existing.sync_version >= section.sync_version) {
    return;
  }

  // Get project name for denormalization
  let projectName = undefined;
  if (section.project_id) {
    const project = await ctx.db
      .query("todoist_projects")
      .withIndex("by_todoist_id", q => q.eq("todoist_id", section.project_id))
      .first();
    projectName = project?.name;
  }

  const sectionData = {
    todoist_id: section.id,
    name: section.name,
    project_id: section.project_id,
    project_name: projectName,
    section_order: section.section_order,
    is_deleted: section.is_deleted || false,
    is_archived: section.is_archived || false,
    last_synced: new Date().toISOString(),
    sync_version: section.sync_version || 0,
  };

  if (existing) {
    await ctx.db.patch(existing._id, sectionData);
  } else {
    await ctx.db.insert("todoist_sections", sectionData);
  }
}

// Helper function for labels
async function upsertLabel(ctx: any, label: any) {
  const existing = await ctx.db
    .query("todoist_labels")
    .withIndex("by_todoist_id", q => q.eq("todoist_id", label.id))
    .first();

  if (existing && existing.sync_version >= label.sync_version) {
    return;
  }

  const labelData = {
    todoist_id: label.id,
    name: label.name,
    color: label.color,
    item_order: label.item_order,
    is_deleted: label.is_deleted || false,
    is_favorite: label.is_favorite || false,
    last_synced: new Date().toISOString(),
    sync_version: label.sync_version || 0,
  };

  if (existing) {
    await ctx.db.patch(existing._id, labelData);
  } else {
    await ctx.db.insert("todoist_labels", labelData);
  }
}
```

## Batch Command Support

For efficient updates, support batched commands:

```typescript
// convex/todoist/actions.ts
export const executeBatchCommands = action({
  args: {
    commands: v.array(v.object({
      type: v.string(),
      uuid: v.string(),
      temp_id: v.optional(v.string()),
      args: v.any(),
    })),
  },
  handler: async (ctx, { commands }) => {
    const client = new TodoistClient(process.env.TODOIST_API_TOKEN!);
    
    const response = await client.request(`${client.syncUrl}/sync`, {
      method: "POST",
      body: JSON.stringify({ commands }),
    });

    // Process temp_id_mapping for new resources
    if (response.temp_id_mapping) {
      // Handle mapping of temporary IDs to real Todoist IDs
      await ctx.runMutation(internal.todoist.mutations.processTempIdMapping, {
        mapping: response.temp_id_mapping,
      });
    }

    // Trigger sync to get the changes
    await ctx.runAction(internal.todoist.actions.performIncrementalSync);

    return response;
  },
});
```

## Sync Token Behavior & Redundancy Benefits

### How Sync Tokens Work

1. **Sync tokens are ONLY from the Sync API** - Regular REST API calls don't return or affect sync tokens
2. **Webhooks don't provide sync tokens** - They deliver real-time updates outside the token system
3. **The sync token is a bookmark** - "I've seen everything up to this point in Todoist's history"

### Redundancy Architecture

```
COMPLETE DATA FLOW:
1. User creates task in UI
2. UI calls → Convex Action (createTask)
3. Action calls → Todoist REST API
4. Action receives → Task data from API response
5. Action stores → Data in Convex DB immediately
6. UI receives → Updated task (instant feedback)
7. Todoist sends → Webhook (milliseconds later)
8. Webhook handler → Confirms/updates if newer version
9. Hourly sync → Catches any missed updates using sync token
```

**Key Point**: The API response is stored IMMEDIATELY in step 5, not waiting for webhooks!

### Benefits of Multiple Sync Paths

1. **Immediate UI feedback** - Actions store data right away
2. **Real-time updates** - Webhooks provide near-instant sync
3. **Reliability** - Hourly sync catches anything missed
4. **No duplicates** - Idempotent upserts with sync_version checking
5. **Efficient API usage** - Sync tokens ensure minimal data transfer

## Computed Properties & Relations

### Convex Query-Time Relations

While denormalized data is stored for performance, you can add computed properties at query time:

```typescript
// Get item with full project details
export const getItemWithProject = query({
  args: { itemId: v.id("todoist_items") },
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get(itemId);
    if (!item?.project_id) return item;
    
    const project = await ctx.db
      .query("todoist_projects")
      .withIndex("by_todoist_id", q => q.eq("todoist_id", item.project_id))
      .first();
      
    return {
      ...item,
      project, // Full project object
    };
  },
});

// Get project with item statistics
export const getProjectWithStats = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db
      .query("todoist_projects")
      .withIndex("by_todoist_id", q => q.eq("todoist_id", projectId))
      .first();
      
    const items = await ctx.db
      .query("todoist_items")
      .withIndex("by_project", q => q.eq("project_id", projectId))
      .collect();
      
    return {
      ...project,
      stats: {
        total: items.length,
        completed: items.filter(i => i.checked === 1).length,
        active: items.filter(i => i.checked === 0 && i.is_deleted === 0).length,
      },
    };
  },
});
```

**Note**: Computed properties are NOT visible in the Convex dashboard - only stored fields appear there.

## Phase 3: UI Development (Future)

### 3.1 Technology Stack
- **Framework**: Next.js 14+ with App Router
- **UI Library**: shadcn/ui with Tailwind CSS
- **State Management**: Convex real-time queries
- **Type Safety**: Full TypeScript with generated types

### 3.2 Core Features
1. Task list with real-time updates
2. Project sidebar navigation
3. Quick add task form
4. Bulk operations (complete, move, delete)
5. Search and filtering
6. Sync status indicator

## Development Workflow

### Local Setup
```bash
# 1. Start Convex dev server
npx convex dev

# 2. In another terminal, expose webhook endpoint
ngrok http 8000  # Convex HTTP actions run on port 8000

# 3. Configure Todoist webhook
# URL: https://[your-ngrok-subdomain].ngrok.io/todoist/webhook

# 4. Run initial sync using action
npx convex run todoist:actions:performIncrementalSync
```

### Deployment
```bash
# 1. Deploy to Convex production
npx convex deploy

# 2. Set environment variables in Convex dashboard
# - TODOIST_API_TOKEN
# - TODOIST_WEBHOOK_SECRET

# 3. Update Todoist webhook URL to production endpoint
```

## Security Considerations

1. **API Keys**: Store in Convex environment variables only
2. **Webhook Security**: Verify HMAC signatures on all webhooks
3. **Data Access**: Single-user system, no cross-user data access
4. **Error Handling**: Never expose API keys in error messages
5. **HTTPS Only**: All external communications over HTTPS

## Future Extensions

### Additional Services
1. **Google Calendar**: OAuth2 flow, calendar sync, event creation
2. **Beeper**: Message sync, search, send capabilities
3. **Cross-Service Features**: Unified search, automation rules

### Advanced Features
1. **Offline Support**: Local mutations with sync queue
2. **Conflict Resolution**: Three-way merge for concurrent edits
3. **Data Export**: Backup to JSON/CSV
4. **Analytics**: Task completion trends, productivity metrics

## Success Metrics

1. **Sync Reliability**: >99% webhook processing success
2. **Data Freshness**: <5 second lag for real-time updates
3. **Query Performance**: <100ms for typical queries
4. **Error Recovery**: Automatic retry with exponential backoff
5. **API Efficiency**: Minimal API calls via incremental sync

## Conclusion

This PRD provides a complete roadmap for building your Personal Master Database System, starting with robust Todoist integration. The phased approach ensures a solid foundation before adding complexity, and the architecture supports future expansion to additional services.