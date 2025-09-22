# Convex-DB Project Development Guide

This is the official development guide for the Personal Master Database System - a Convex-based centralized data hub that syncs with external services.

## Project Philosophy

### The Foundation: Data Integrity Above All
This project is built upon the backbone of a **strong, reliable data layer** that includes redundant methods of importing and keeping data in sync from multiple sources. The integrity of our data imports is the **top priority**.

### Master Database Concept
While external services remain the source of truth, our master database is designed to **mirror them as closely as possible**, creating a unified, queryable interface across all your personal data. This allows us to:
- Build cross-service queries and analytics
- Maintain data availability even when services are down
- Create powerful automations across different platforms
- Enable rapid UI experimentation

### UI Development Philosophy
UIs are intentionally secondary - we want to enable the creation of **quickly spun up interfaces** that take advantage of our strong and accurate data layer. These UIs may:
- Develop into long-standing tools
- Be quickly discarded after serving their purpose
- Serve as experiments for new workflows
- Be rebuilt entirely without affecting the data layer

### Integration Independence
Each data integration is developed and maintained **separately** with emphasis on:
- Comprehensive testing for each integration
- Independent monitoring and health checks
- Service-specific error handling
- Modular architecture that doesn't affect other integrations

## Code Quality Standards

### CRITICAL: Before Any Commit or PR
All code must pass these checks without errors:

1. **TypeScript Compilation**: `bun tsc` must pass with zero errors
2. **Linting**: `bun run lint` must pass with zero errors
3. **Tests**: `bun test` must pass all test suites

### Type Safety Requirements
- **NEVER use `any` type** - it bypasses all type checking
- **MINIMIZE use of `unknown`** - only use when type truly can't be known (e.g., external API responses)
- **AVOID type assertions** - prefer type guards and proper inference
- **NO `@ts-ignore` or `@ts-expect-error`** - fix the underlying issue
- **Use strict TypeScript config** - all strict flags enabled

### Type Safety Progression
```typescript
// ❌ WORST: Never use any
const data: any = response;

// ⚠️ BETTER: Use unknown for truly dynamic data
const data: unknown = response;
if (typeof data === 'object' && data !== null && 'id' in data) {
  // Type guard to narrow the type
}

// ✅ BEST: Define proper types
interface ApiResponse {
  id: string;
  // ... other fields
}
const data = response as ApiResponse; // Only if you're certain

// ✅ BEST: Use discriminated unions for variants
type TableName = "todoist_items" | "todoist_projects" | "todoist_sections";
const table: TableName = "todoist_items";

// ✅ BEST: Define specific types for dynamic objects
interface TaskUpdates {
  content?: string;
  priority?: number;
  due?: DueDate | null;
}
const updates: TaskUpdates = {};
```

### When `unknown` is Acceptable
1. **External API responses** before validation
2. **Error handling** for catch blocks
3. **Legacy code migration** as a stepping stone from `any`
4. **Type guards** before narrowing to specific types

### When to Avoid `unknown`
1. **Internal functions** - always define proper types
2. **Database schemas** - use Convex validators
3. **Component props** - use explicit interfaces
4. **Return types** - be specific about what you return

### When `any` is Acceptable (With ESLint Disable)
Only use `any` with explicit justification and ESLint disable comment:
1. **Dynamic table queries** - when iterating over table names dynamically
2. **Object filtering** - when TypeScript can't track dynamic property removal
3. **Third-party integrations** - when types are truly unknowable

Always include:
```typescript
// Note: Explain why any is necessary here
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const example: any = dynamicValue;
```

## Core Data Layer Principles

### 1. Redundant Sync Architecture
Every integration must implement **multiple sync mechanisms**:
- **Primary**: Real-time webhooks for instant updates
- **Secondary**: Periodic sync (cron) as backup
- **Tertiary**: Manual sync triggers for debugging
- **Recovery**: Automatic retry with exponential backoff

### 2. Data Integrity Patterns
- **Idempotent Operations**: Same sync can run multiple times safely
- **Version Control**: Track sync versions to prevent overwrites
- **Soft Deletion**: Never lose data, use `is_deleted` flags
- **Audit Trail**: Track when and how data was synced

### 3. Service Isolation
```typescript
// Each service has its own isolated structure
convex/
  todoist/
    actions.ts      // API calls
    mutations.ts    // DB operations
    queries.ts      // Public queries
    sync.ts         // Sync orchestration
    webhook.ts      // Webhook handler
    monitoring.ts   // Health checks
    __tests__/      // Service-specific tests
```

### 4. Monitoring & Observability
Each integration must expose:
```typescript
export const getServiceHealth = query({
  handler: async (ctx) => ({
    lastSync: syncState.last_sync,
    syncStatus: syncState.status,
    errorRate: recentErrors.length / totalSyncs,
    dataFreshness: Date.now() - lastSync,
    webhookHealth: webhookStats,
  })
});
```

## UI Development Principles

### 1. Optimistic UI Pattern
Despite UIs being secondary, when we build them, we build them right:
```typescript
// ALWAYS add optimistic updates to user-facing mutations
const completeTask = useMutation(api.todoist.actions.completeTask)
  .withOptimisticUpdate((localStore, args) => {
    // Instant feedback is non-negotiable
  });
```

### 2. Disposable UI Philosophy
- **Quick to Build**: Use component libraries (shadcn/ui)
- **Easy to Replace**: No business logic in components
- **Data-Driven**: UI is just a view of the data layer
- **Experimentation-Friendly**: Try new UX patterns freely

### 3. Real-Time by Default
- Every query is a live subscription
- No manual refresh buttons
- No polling or intervals
- Trust the data layer to stay current

### 4. Progressive Enhancement (TBD)
- Start with basic CRUD
- Add advanced features as needed
- Consider offline support later
- Mobile responsiveness when required

## Integration Development Standards

### Testing Requirements
Each integration must have:
```typescript
// __tests__/todoist.test.ts
describe("Todoist Integration", () => {
  test("webhook signature verification");
  test("idempotent sync operations");
  test("version conflict resolution");
  test("soft deletion behavior");
  test("error recovery and retry");
  test("data denormalization accuracy");
});
```

### Monitoring Dashboard
Every integration needs a monitoring query:
```typescript
export const getIntegrationDashboard = query({
  handler: async (ctx) => ({
    summary: {
      totalRecords: await ctx.db.query("todoist_items").count(),
      activeRecords: await ctx.db.query("todoist_items")
        .filter(q => q.eq(q.field("is_deleted"), 0))
        .count(),
      lastSync: syncState.last_sync,
      syncHealth: calculateHealth(syncState),
    },
    recentErrors: await getRecentErrors(ctx),
    syncPerformance: await getSyncMetrics(ctx),
    dataFreshness: await getDataFreshness(ctx),
  })
});
```

### Error Recovery Patterns
```typescript
// Exponential backoff for failed syncs
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000]; // ms

export const syncWithRetry = action({
  handler: async (ctx, { attempt = 0 }) => {
    try {
      await performSync(ctx);
      // Reset error count on success
      await ctx.runMutation(internal.mutations.resetErrorCount);
    } catch (error) {
      if (attempt < RETRY_DELAYS.length) {
        // Schedule retry with backoff
        await ctx.scheduler.runAfter(
          RETRY_DELAYS[attempt],
          internal.actions.syncWithRetry,
          { attempt: attempt + 1 }
        );
      } else {
        // Max retries reached, alert monitoring
        await ctx.runMutation(internal.mutations.recordCriticalError, {
          error: error.message,
          service: "todoist",
        });
      }
    }
  }
});
```

## Todoist Integration (Current Implementation)

### Architecture Overview
Todoist serves as our first integration, establishing patterns for future services.

### CRITICAL: Todoist API Version
**ONLY USE TODOIST API v1** - This is the current supported API!

- **API v1**: `https://api.todoist.com/api/v1/*` ✅ **CURRENT API - USE THIS**
- **Sync API v9**: `https://api.todoist.com/sync/v9/*` ❌ **DEPRECATED - DO NOT USE**
- **REST API v2**: `https://api.todoist.com/rest/v2/*` ❌ **DEPRECATED - DO NOT USE**

The current API v1 uses:
- Base URL: `https://api.todoist.com/api/v1`
- Sync endpoint: `https://api.todoist.com/api/v1/sync`
- Authentication: Bearer token in Authorization header
- Commands: `item_add`, `item_update`, `item_complete`, `item_delete`, etc.

### Sync Architecture
Three-layer redundancy ensures data integrity:
1. **API Response Storage**: Immediate write after successful API calls
2. **Webhook Confirmation**: Real-time updates (milliseconds after changes)
3. **Periodic Sync**: Hourly cron job catches any missed updates

### Data Flow
```
User Action → Convex Action → Todoist API → Store in Convex → UI Update
                                    ↓
                            Webhook validates → Update if newer
                                    ↑
                            Hourly sync → Catch missed updates
```

### Technical Implementation
```typescript
// Actions handle external API calls
export const createTask = action({
  handler: async (ctx, args) => {
    const response = await todoistClient.create(args);
    await ctx.runMutation(internal.mutations.upsertItem, response);
    return response; // UI gets immediate feedback
  }
});

// Mutations ensure data integrity
export const upsertItem = internalMutation({
  handler: async (ctx, { item }) => {
    const existing = await ctx.db
      .query("todoist_items")
      .withIndex("by_todoist_id", q => q.eq("todoist_id", item.id))
      .first();
    
    // Version check prevents overwrites
    if (existing && existing.sync_version >= item.version) {
      return; // Skip if we have newer data
    }
    
    // Upsert with denormalized data
    await ctx.db.upsert({...item, last_synced: Date.now()});
  }
});
```

### Monitoring & Health
```bash
# Check integration health
npx convex run todoist:monitoring.getServiceHealth

# View recent sync errors
npx convex run todoist:monitoring.getRecentErrors

# Force manual sync
npx convex run todoist:sync.performIncrementalSync
```

### Testing Todoist Integration
```bash
# Run integration tests
bun test convex/todoist/__tests__

# Test webhook locally
curl -X POST http://localhost:8000/todoist/webhook \
  -H "X-Todoist-Hmac-SHA256: [signature]" \
  -d '{"event_name": "item:added", ...}'
```

## Development Workflow

### Local Development
```bash
# Terminal 1: Start Convex dev server
npx convex dev

# Terminal 2: Expose webhook endpoint (if testing webhooks)
ngrok http 8000

# Terminal 3: Start frontend (when ready)
bun dev
```

### Adding a New Integration
1. **Design Phase**
   - Document API capabilities and limitations
   - Plan redundant sync mechanisms
   - Design schema with denormalization strategy

2. **Implementation Phase**
   ```bash
   # Create integration structure
   mkdir -p convex/[service]/{__tests__}
   touch convex/[service]/{actions,mutations,queries,sync,webhook,monitoring}.ts
   ```

3. **Testing Phase**
   - Unit tests for each sync mechanism
   - Integration tests with mock API
   - Webhook signature verification
   - Error recovery scenarios

4. **Monitoring Phase**
   - Implement health check query
   - Add to global monitoring dashboard
   - Set up error alerting

### Environment Variables
```env
# .env.local
TODOIST_API_TOKEN=your_api_token
TODOIST_WEBHOOK_SECRET=generate_random_secret

# Future services
GOOGLE_CALENDAR_CLIENT_ID=...
BEEPER_ACCESS_TOKEN=...
```

## Common Implementation Patterns

### Soft Delete Pattern
```typescript
// Never hard delete, always soft delete
await ctx.db.patch(item._id, { 
  is_deleted: 1,
  deleted_at: new Date().toISOString()
});
```

### Idempotent Sync Pattern
```typescript
export const upsertWithVersionCheck = internalMutation({
  handler: async (ctx, { data }) => {
    const existing = await ctx.db
      .query("service_items")
      .withIndex("by_external_id", q => q.eq("external_id", data.id))
      .first();
    
    // Skip if we have newer version
    if (existing && existing.sync_version >= data.version) {
      return { updated: false, reason: "newer_version_exists" };
    }
    
    // Upsert with audit trail
    await ctx.db.upsert({
      ...data,
      last_synced: Date.now(),
      sync_source: "webhook", // or "cron", "manual", "api_response"
    });
    
    return { updated: true };
  }
});
```

### Optimistic Update Pattern
```typescript
// Client-side optimistic updates for instant feedback
const action = useMutation(api.service.actions.updateItem)
  .withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.service.queries.getItem, { id: args.id });
    if (current) {
      // ALWAYS create new objects, never mutate
      localStore.setQuery(
        api.service.queries.getItem,
        { id: args.id },
        { ...current, ...args.updates }
      );
    }
  });
```

### Service Health Pattern
```typescript
export const getServiceHealth = query({
  handler: async (ctx) => {
    const syncState = await ctx.db
      .query("sync_state")
      .withIndex("by_service", q => q.eq("service", SERVICE_NAME))
      .first();
    
    const now = Date.now();
    const lastSync = new Date(syncState?.last_sync || 0).getTime();
    const timeSinceSync = now - lastSync;
    
    return {
      status: determineStatus(timeSinceSync, syncState?.error_count),
      lastSync: syncState?.last_sync,
      nextSync: calculateNextSync(syncState),
      metrics: {
        totalRecords: await getTotalRecords(ctx),
        syncFrequency: SYNC_INTERVAL,
        averageSyncTime: syncState?.avg_sync_duration,
        errorRate: calculateErrorRate(syncState),
      },
      alerts: generateAlerts(timeSinceSync, syncState),
    };
  }
});
```

## UI Implementation Patterns

### Loading States with Suspense
```typescript
function TaskList() {
  const tasks = useQuery(api.todoist.queries.getActiveItems);
  
  // Handle loading and error states
  if (tasks === undefined) return <Skeleton />;
  if (tasks === null) return <ErrorBoundary />;
  
  return <TaskGrid tasks={tasks} />;
}
```

### Error Handling in Actions
```typescript
export const updateTask = action({
  handler: async (ctx, args) => {
    try {
      const response = await todoistClient.update(args);
      await ctx.runMutation(internal.mutations.upsertItem, response);
      return { success: true, data: response };
    } catch (error) {
      // Log with context for monitoring
      console.error("API Error", { 
        service: "todoist", 
        action: "updateTask", 
        args,
        error: error.message 
      });
      
      // Return user-friendly error
      return { 
        success: false, 
        error: "Unable to update task. Please try again.",
        code: error.code || "UNKNOWN_ERROR"
      };
    }
  }
});
```

## Performance & Scaling

### Query Optimization
```typescript
// Use indexes for common access patterns
defineTable({
  // ... fields
})
.index("by_external_id", ["external_id"])
.index("active_items", ["is_deleted", "checked"])
.index("by_sync_time", ["last_synced"]);

// Paginate large result sets
export const getPaginatedItems = query({
  args: {
    cursor: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, { cursor, limit = 50 }) => {
    const results = await ctx.db
      .query("items")
      .order("desc")
      .paginate({ cursor, limit });
    return results;
  }
});
```

### Batch Processing
```typescript
// Process large syncs in chunks
export const batchSync = action({
  handler: async (ctx, { items }) => {
    const BATCH_SIZE = 100;
    
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      
      await ctx.runMutation(internal.mutations.upsertBatch, {
        items: batch,
        batchNumber: i / BATCH_SIZE,
        totalBatches: Math.ceil(items.length / BATCH_SIZE),
      });
      
      // Optional: Add progress tracking
      await ctx.runMutation(internal.mutations.updateSyncProgress, {
        progress: (i + batch.length) / items.length,
      });
    }
  }
});
```

## Security Best Practices

### API Key Management
```typescript
// Never expose keys in code
const API_KEY = process.env.SERVICE_API_KEY;
if (!API_KEY) {
  throw new Error("SERVICE_API_KEY not configured");
}
```

### Webhook Security
```typescript
export const handleWebhook = httpAction(async (ctx, request) => {
  const signature = request.headers.get("X-Service-Signature");
  const body = await request.text();
  
  // Verify signature
  const expectedSignature = crypto
    .createHmac("sha256", process.env.WEBHOOK_SECRET!)
    .update(body)
    .digest("hex");
    
  if (signature !== expectedSignature) {
    return new Response("Unauthorized", { status: 401 });
  }
  
  // Process webhook...
});
```

### Error Sanitization
```typescript
// Never leak sensitive data in errors
catch (error) {
  console.error("Full error for monitoring:", error);
  
  // Return sanitized error to client
  return {
    success: false,
    error: "Operation failed",
    code: getErrorCode(error),
  };
}
```

## Debugging & Development Tools

### Global Monitoring Dashboard
```typescript
// convex/monitoring/dashboard.ts
export const getMasterDashboard = query({
  handler: async (ctx) => {
    const services = ["todoist", "google_calendar", "beeper"];
    const dashboard = {};
    
    for (const service of services) {
      const health = await ctx.runQuery(
        api[service].monitoring.getServiceHealth
      );
      dashboard[service] = health;
    }
    
    return {
      services: dashboard,
      overallHealth: calculateOverallHealth(dashboard),
      alerts: aggregateAlerts(dashboard),
      lastUpdated: Date.now(),
    };
  }
});
```

### Debug Commands
```bash
# Service-specific health check
npx convex run todoist:monitoring.getServiceHealth

# Check recent sync errors
npx convex run todoist:monitoring.getRecentErrors

# Force manual sync
npx convex run todoist:sync.performIncrementalSync

# View webhook events
npx convex run todoist:debug.getRecentWebhooks

# Global monitoring dashboard
npx convex run monitoring:dashboard.getMasterDashboard
```

### Development Helpers
```typescript
// Log with structured context
export const debugLog = (service: string, action: string, data: any) => {
  if (process.env.NODE_ENV === "development") {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service,
      action,
      data,
    }, null, 2));
  }
};
```

## Future Integrations Roadmap

### Planned Services
1. **Google Calendar** 
   - OAuth2 authentication flow
   - Event sync with conflict resolution
   - Recurring event handling

2. **Beeper/Matrix**
   - Message history sync
   - Real-time message updates
   - Multi-room support

3. **GitHub**
   - Issues and PR tracking
   - Commit history analysis
   - Notification sync

4. **Linear**
   - Advanced project management
   - Cross-service task linking
   - Team collaboration features

### Advanced Features Roadmap
- **Unified Search**: Query across all integrated services
- **Smart Automations**: If-this-then-that rules across services
- **Data Export**: Backup all data to common formats
- **Analytics Dashboard**: Personal productivity insights
- **Mobile Apps**: iOS/Android clients leveraging the data layer
- **Voice Interface**: Alexa/Google Assistant integration

## Key Principles Summary

### Data Layer First
- **Integrity**: Multiple sync mechanisms ensure data accuracy
- **Isolation**: Each service integration is independent
- **Monitoring**: Built-in health checks and observability
- **Testing**: Comprehensive test coverage for each integration

### UI Second
- **Disposable**: UIs can be quickly built and discarded
- **Optimistic**: Always provide instant feedback
- **Real-time**: Leverage Convex's reactive subscriptions
- **Type-safe**: End-to-end TypeScript

### Development Philosophy
- **Incremental**: Start simple, enhance over time
- **Maintainable**: Clear patterns over clever code
- **Observable**: Monitor everything, debug easily
- **Reliable**: Handle errors gracefully, retry intelligently

When building new integrations or UIs, always refer back to these core principles. The strength of this system lies in its robust data layer - everything else builds upon that foundation.