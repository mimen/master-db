# Simple Sync Monitoring Plan

## Overview
Minimal implementation for monitoring scheduled Todoist sync jobs, tracking success/failure rates, and enabling dashboard/notification capabilities.

## Scope
- **Focus**: Only scheduled sync jobs (cron-triggered)
- **Track**: Success/failure of each sync run
- **Purpose**: Enable monitoring dashboards and failure notifications
- **Approach**: Simple, maintainable, no complex retry logic

## Implementation

### 1. Database Schema Addition

Add a single table to `convex/schema.ts`:

```typescript
// Simple sync log for scheduled runs
sync_logs: defineTable({
  service: v.string(), // "todoist"
  sync_type: v.union(v.literal("full"), v.literal("incremental")),
  status: v.union(v.literal("success"), v.literal("failed")),
  started_at: v.string(),
  completed_at: v.string(),
  duration_ms: v.number(),
  items_synced: v.number(),
  error_message: v.optional(v.string()),
  sync_token_used: v.optional(v.string()),
  sync_token_new: v.optional(v.string()),
})
  .index("by_service", ["service", "started_at"])
  .index("recent_failures", ["service", "status", "started_at"]),
```

### 2. Update Sync Actions

Modify `convex/todoist/sync.ts` to log results:

```typescript
export const performIncrementalSync = action({
  handler: async (ctx) => {
    const startTime = Date.now();
    const syncLog = {
      service: "todoist",
      sync_type: "incremental" as const,
      started_at: new Date(startTime).toISOString(),
    };
    
    try {
      console.log("Starting incremental Todoist sync...");
      
      const token = process.env.TODOIST_API_TOKEN;
      if (!token) {
        throw new Error("TODOIST_API_TOKEN not configured");
      }

      // Get current sync state
      const syncState = await ctx.runQuery(internal.todoist.queries.getSyncState);
      if (!syncState?.last_sync_token) {
        console.log("No sync token found, running initial sync instead");
        return ctx.runAction(internal.todoist.initialSync.runInitialSync);
      }

      // Record the token we're using
      syncLog.sync_token_used = syncState.last_sync_token;

      // ... existing sync logic ...

      // Log successful sync
      await ctx.runMutation(internal.todoist.mutations.logSyncResult, {
        ...syncLog,
        status: "success",
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        items_synced: changeCount,
        sync_token_new: syncData.sync_token,
      });

      return {
        changeCount,
        syncToken: syncData.sync_token,
        fullSync: false,
      };
      
    } catch (error) {
      console.error("Sync failed:", error);
      
      // Log failed sync
      await ctx.runMutation(internal.todoist.mutations.logSyncResult, {
        ...syncLog,
        status: "failed",
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        items_synced: 0,
        error_message: error.message,
      });
      
      throw error;
    }
  },
});
```

Also update `convex/todoist/initialSync.ts` similarly:

```typescript
export const runInitialSync = action({
  handler: async (ctx) => {
    const startTime = Date.now();
    const syncLog = {
      service: "todoist",
      sync_type: "full" as const,
      started_at: new Date(startTime).toISOString(),
    };
    
    try {
      // ... existing logic ...
      
      // Log successful sync
      await ctx.runMutation(internal.todoist.mutations.logSyncResult, {
        ...syncLog,
        status: "success",
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        items_synced: totalItems,
        sync_token_new: syncData.sync_token,
      });
      
    } catch (error) {
      // Log failed sync
      await ctx.runMutation(internal.todoist.mutations.logSyncResult, {
        ...syncLog,
        status: "failed",
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        items_synced: 0,
        error_message: error.message,
      });
      
      throw error;
    }
  },
});
```

### 3. Add Logging Mutation

Add to `convex/todoist/mutations.ts`:

```typescript
export const logSyncResult = internalMutation({
  args: {
    service: v.string(),
    sync_type: v.union(v.literal("full"), v.literal("incremental")),
    status: v.union(v.literal("success"), v.literal("failed")),
    started_at: v.string(),
    completed_at: v.string(),
    duration_ms: v.number(),
    items_synced: v.number(),
    error_message: v.optional(v.string()),
    sync_token_used: v.optional(v.string()),
    sync_token_new: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("sync_logs", args);
  },
});
```

### 4. Create Monitoring Queries

Create `convex/todoist/monitoring.ts`:

```typescript
import { query } from "../_generated/server";
import { v } from "convex/values";

// Get current sync health status
export const getSyncHealth = query({
  handler: async (ctx) => {
    // Get last 10 syncs
    const recentSyncs = await ctx.db
      .query("sync_logs")
      .withIndex("by_service", q => q.eq("service", "todoist"))
      .order("desc")
      .take(10);
    
    // Get last successful sync
    const lastSuccess = await ctx.db
      .query("sync_logs")
      .withIndex("by_service", q => 
        q.eq("service", "todoist")
         .eq("status", "success")
      )
      .order("desc")
      .first();
    
    // Count recent failures (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentFailures = await ctx.db
      .query("sync_logs")
      .withIndex("recent_failures", q => 
        q.eq("service", "todoist")
         .eq("status", "failed")
         .gte("started_at", oneDayAgo)
      )
      .collect();
    
    // Calculate metrics
    const failureRate = recentSyncs.length > 0 
      ? (recentSyncs.filter(s => s.status === "failed").length / recentSyncs.length) * 100
      : 0;
    
    const timeSinceLastSuccess = lastSuccess 
      ? Date.now() - new Date(lastSuccess.completed_at).getTime()
      : null;
    
    return {
      status: determineStatus(timeSinceLastSuccess, recentFailures.length),
      lastSuccessfulSync: lastSuccess?.completed_at,
      minutesSinceLastSuccess: timeSinceLastSuccess ? Math.floor(timeSinceLastSuccess / 60000) : null,
      recentFailureCount: recentFailures.length,
      last10SyncFailureRate: failureRate.toFixed(1) + "%",
      isHealthy: recentFailures.length < 3 && (timeSinceLastSuccess ? timeSinceLastSuccess < 30 * 60 * 1000 : true),
    };
  },
});

// Get sync history for dashboard
export const getSyncHistory = query({
  args: { 
    limit: v.optional(v.number()),
    hoursBack: v.optional(v.number()),
  },
  handler: async (ctx, { limit = 50, hoursBack = 24 }) => {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    
    const syncs = await ctx.db
      .query("sync_logs")
      .withIndex("by_service", q => 
        q.eq("service", "todoist")
         .gte("started_at", since)
      )
      .order("desc")
      .take(limit);
    
    return syncs.map(sync => ({
      ...sync,
      durationSeconds: (sync.duration_ms / 1000).toFixed(1),
      timeAgo: getTimeAgo(sync.completed_at),
    }));
  },
});

// Get sync statistics
export const getSyncStats = query({
  args: { 
    period: v.union(v.literal("hour"), v.literal("day"), v.literal("week")),
  },
  handler: async (ctx, { period }) => {
    const hoursBack = period === "hour" ? 1 : period === "day" ? 24 : 168;
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    
    const syncs = await ctx.db
      .query("sync_logs")
      .withIndex("by_service", q => 
        q.eq("service", "todoist")
         .gte("started_at", since)
      )
      .collect();
    
    const successful = syncs.filter(s => s.status === "success");
    const failed = syncs.filter(s => s.status === "failed");
    
    return {
      period,
      totalSyncs: syncs.length,
      successfulSyncs: successful.length,
      failedSyncs: failed.length,
      successRate: syncs.length > 0 
        ? ((successful.length / syncs.length) * 100).toFixed(1) + "%" 
        : "N/A",
      averageDuration: successful.length > 0
        ? (successful.reduce((sum, s) => sum + s.duration_ms, 0) / successful.length / 1000).toFixed(1) + "s"
        : "N/A",
      totalItemsSynced: successful.reduce((sum, s) => sum + s.items_synced, 0),
    };
  },
});

// Check if we should send an alert
export const checkAlertConditions = query({
  handler: async (ctx) => {
    const health = await ctx.runQuery(api.todoist.monitoring.getSyncHealth);
    
    const alerts = [];
    
    // Alert if no successful sync in 30 minutes (6 sync cycles)
    if (health.minutesSinceLastSuccess && health.minutesSinceLastSuccess > 30) {
      alerts.push({
        severity: "critical",
        message: `No successful sync in ${health.minutesSinceLastSuccess} minutes`,
        trigger: "extended_failure",
      });
    }
    
    // Alert if 3+ consecutive failures
    if (health.recentFailureCount >= 3) {
      alerts.push({
        severity: "warning",
        message: `${health.recentFailureCount} consecutive sync failures`,
        trigger: "consecutive_failures",
      });
    }
    
    // Alert if failure rate > 50%
    const failureRate = parseFloat(health.last10SyncFailureRate);
    if (failureRate > 50) {
      alerts.push({
        severity: "warning",
        message: `High failure rate: ${health.last10SyncFailureRate}`,
        trigger: "high_failure_rate",
      });
    }
    
    return {
      shouldAlert: alerts.length > 0,
      alerts,
      health,
    };
  },
});

// Helper functions
function determineStatus(timeSinceLastSuccess: number | null, recentFailures: number): string {
  if (!timeSinceLastSuccess) return "unknown";
  
  const minutesSince = timeSinceLastSuccess / 60000;
  
  if (minutesSince < 10) return "healthy";
  if (minutesSince < 30) return "degraded";
  return "critical";
}

function getTimeAgo(timestamp: string): string {
  const minutes = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
  
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

## Usage

### Check Sync Health
```bash
npx convex run todoist:monitoring.getSyncHealth
```

Returns:
```json
{
  "status": "healthy",
  "lastSuccessfulSync": "2024-01-15T10:30:00Z",
  "minutesSinceLastSuccess": 3,
  "recentFailureCount": 0,
  "last10SyncFailureRate": "0.0%",
  "isHealthy": true
}
```

### View Sync History
```bash
npx convex run todoist:monitoring.getSyncHistory --hoursBack 6
```

### Get Statistics
```bash
npx convex run todoist:monitoring.getSyncStats --period day
```

### Check for Alerts
```bash
npx convex run todoist:monitoring.checkAlertConditions
```

## Dashboard Integration

The queries provide simple data structures that can be used to:
1. Display sync health status (green/yellow/red)
2. Show recent sync history with success/failure
3. Graph sync performance over time
4. Trigger notifications when alert conditions are met

## Future Enhancements (if needed)

1. Add a cron job to check alert conditions and send notifications
2. Add more sophisticated alert rules
3. Track sync performance by day of week/time of day
4. Add data freshness tracking per entity type

## Benefits

- **Simple**: Single table, straightforward queries
- **Focused**: Only tracks scheduled syncs
- **Actionable**: Clear health status and alert conditions
- **Maintainable**: Easy to understand and modify
- **Extensible**: Can add more metrics without breaking changes