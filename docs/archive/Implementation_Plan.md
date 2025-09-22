# Personal Master Database - Implementation Plan

## Overview
This plan breaks down the implementation into small, testable phases. Each phase builds on the previous one and can be verified independently.

## Phase 1: Foundation & Initial Import (Day 1-2)

### 1.1 Project Setup
```bash
# Create and initialize project
npx create-convex-app@latest personal-master-db --template typescript
cd personal-master-db
bun add dotenv zod
```

### 1.2 Environment Configuration
Create `.env.local`:
```env
TODOIST_API_TOKEN=your_api_token_here
```

### 1.3 Basic Database Schema
Start with minimal schema for testing:
```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Start with just items and projects
  todoist_items: defineTable({
    todoist_id: v.string(),
    content: v.string(),
    project_id: v.optional(v.string()),
    checked: v.number(), // 0 = unchecked, 1 = checked
    added_at: v.string(),
    sync_version: v.number(),
  }).index("by_todoist_id", ["todoist_id"]),

  todoist_projects: defineTable({
    todoist_id: v.string(),
    name: v.string(),
    color: v.string(),
    sync_version: v.number(),
  }).index("by_todoist_id", ["todoist_id"]),

  sync_state: defineTable({
    service: v.string(),
    last_sync_token: v.optional(v.string()),
    last_full_sync: v.string(),
  }).index("by_service", ["service"]),
});
```

### 1.4 Initial Sync Action
```typescript
// convex/todoist/initialSync.ts
import { action } from "../_generated/server";
import { internal } from "../_generated/api";

export const runInitialSync = action({
  handler: async (ctx) => {
    console.log("Starting initial Todoist sync...");
    
    const token = process.env.TODOIST_API_TOKEN;
    if (!token) {
      throw new Error("TODOIST_API_TOKEN not configured");
    }

    // Initialize sync state
    await ctx.runMutation(internal.todoist.mutations.initializeSyncState);

    // Perform full sync using API v1
    const response = await fetch("https://api.todoist.com/api/v1/sync", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sync_token: "*",
        resource_types: ["projects", "items", "labels", "sections", "notes", "reminders"],
      }),
    });

    if (!response.ok) {
      throw new Error(`Todoist API error: ${response.status}`);
    }

    const syncData = await response.json();

    // Store projects
    console.log(`Syncing ${syncData.projects.length} projects...`);
    for (const project of syncData.projects) {
      await ctx.runMutation(internal.todoist.mutations.upsertProject, {
        project,
      });
    }

    // Store items
    console.log(`Syncing ${syncData.items.length} items...`);
    for (const item of syncData.items) {
      await ctx.runMutation(internal.todoist.mutations.upsertItem, {
        item: item,
      });
    }

    // Update sync token
    await ctx.runMutation(internal.todoist.mutations.updateSyncToken, {
      token: syncData.sync_token,
    });

    return {
      projectsCount: syncData.projects.length,
      itemsCount: syncData.items.length,
      syncToken: syncData.sync_token,
    };
  },
});
```

### 1.5 Test Initial Import
```bash
# Run Convex dev
npx convex dev

# In another terminal, trigger initial sync
npx convex run todoist:initialSync:runInitialSync
```

### Verification Checklist:
- [ ] Convex project created and running
- [ ] Environment variables configured
- [ ] Initial sync imports all projects
- [ ] Initial sync imports all items
- [ ] Sync token stored correctly
- [ ] Data visible in Convex dashboard

---

## Phase 2: Complete Schema & Sync Logic (Day 3-4)

### 2.1 Expand Schema
Add all entities from PRD:
- Sections
- Labels  
- Notes
- Reminders
- Completed fields for items
- All project fields

### 2.2 Implement Sync Helpers
- `upsertSection()`
- `upsertLabel()`
- `upsertNote()`
- `upsertReminder()`
- Add sync_version checking

### 2.3 Incremental Sync
```typescript
// convex/todoist/sync.ts
export const performIncrementalSync = action({
  handler: async (ctx) => {
    const syncState = await ctx.runQuery(internal.todoist.queries.getSyncState);
    // Use stored sync token for incremental updates
  },
});
```

### Verification Checklist:
- [ ] All entity types syncing
- [ ] Incremental sync using tokens
- [ ] Sync version prevents overwrites
- [ ] Denormalized fields populated

---

## Phase 3: CRUD Operations via API (Day 5-6)

### 3.1 Item Operations
```typescript
// convex/todoist/actions.ts
export const createItem = action({...});
export const updateItem = action({...});
export const completeItem = action({...});
export const deleteItem = action({...});
```

### 3.2 Project Operations
```typescript
export const createProject = action({...});
export const updateProject = action({...});
export const archiveProject = action({...});
```

### 3.3 Test UI Commands
Create simple test commands:
```bash
# Create a test item
npx convex run todoist:actions:createItem '{"content": "Test item from Convex"}'
```

### Verification Checklist:
- [ ] Create item works and stores immediately
- [ ] Update item works
- [ ] Complete item works
- [ ] All operations update Convex DB

---

## Phase 4: Webhook Integration (Day 7)

### 4.1 HTTP Router Setup
```typescript
// convex/http.ts
import { httpRouter } from "convex/server";
import { handleTodoistWebhook } from "./todoist/webhook";

const http = httpRouter();
http.route({
  path: "/todoist/webhook",
  method: "POST",
  handler: handleTodoistWebhook,
});

export default http;
```

### 4.2 Webhook Handler
- Signature verification
- Event storage
- Async processing

### 4.3 Local Testing with ngrok
```bash
# Start ngrok
ngrok http 8000

# Configure webhook in Todoist app settings
```

### Verification Checklist:
- [ ] Webhook endpoint accessible
- [ ] Signature verification works
- [ ] Events processed correctly
- [ ] No duplicate data issues

---

## Phase 5: Scheduled Sync & Error Handling (Day 8)

### 5.1 Cron Job Setup
```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval(
  "todoist hourly sync",
  { minutes: 60 },
  internal.todoist.actions.performIncrementalSync
);

export default crons;
```

### 5.2 Error Handling
- Retry logic for failed syncs
- Error state tracking
- Graceful degradation

### Verification Checklist:
- [ ] Cron job runs on schedule
- [ ] Errors logged properly
- [ ] Sync recovers from failures
- [ ] No data loss during errors

---

## Phase 6: Query Layer & Optimization (Day 9)

### 6.1 Common Queries
```typescript
// convex/todoist/queries.ts
export const getActiveItems = query({...});
export const getItemsByProject = query({...});
export const getProjectWithStats = query({...});
```

### 6.2 Performance Optimization
- Add strategic indexes
- Implement pagination
- Cache computed values

### Verification Checklist:
- [ ] Queries return correct data
- [ ] Performance acceptable (<100ms)
- [ ] Indexes used effectively

---

## Phase 7: Basic UI (Day 10)

### 7.1 Simple Next.js UI
```typescript
// app/page.tsx
export default function HomePage() {
  const items = useQuery(api.todoist.queries.getActiveItems);
  const projects = useQuery(api.todoist.queries.getProjects);
  // Basic item list UI
}
```

### 7.2 Real-time Updates
- Live item updates
- Sync status indicator
- Error notifications

### Verification Checklist:
- [ ] UI shows current data
- [ ] Real-time updates work
- [ ] Can create/update via UI
- [ ] Sync status visible

---

## Phase 8: Production Deployment (Day 11)

### 8.1 Deploy to Convex Production
```bash
npx convex deploy
```

### 8.2 Configure Production
- Set environment variables
- Configure production webhook URL
- Run initial sync in production

### 8.3 Monitoring Setup
- Error tracking
- Sync health dashboard
- Usage metrics

### Verification Checklist:
- [ ] Production deployment live
- [ ] Webhooks configured
- [ ] Initial sync complete
- [ ] Monitoring active

---

## Testing Strategy Throughout

### Unit Tests
- Test each upsert function
- Test sync version logic
- Test webhook signature

### Integration Tests  
- Full sync flow
- API operations
- Webhook processing

### End-to-End Tests
- Create item in UI → Appears in Todoist
- Create item in Todoist → Appears in UI
- Complete item → Syncs both ways

---

## Risk Mitigation

1. **API Rate Limits**: Implement exponential backoff
2. **Data Loss**: Triple redundancy ensures no data loss
3. **Sync Conflicts**: sync_version prevents overwrites
4. **Webhook Failures**: Hourly sync as backup

---

## Success Criteria

1. All Todoist data synced to Convex
2. <5 second lag for updates
3. 99%+ sync reliability
4. No data loss or corruption
5. Smooth UI experience

---

## Next Steps After Phase 8

- Add Google Calendar integration
- Implement cross-service features
- Add automation rules
- Build mobile app