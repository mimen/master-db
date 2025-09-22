# Sync Monitoring Implementation Plan

## Overview
Implementation plan for comprehensive sync status monitoring and error tracking for the Todoist integration, following the architecture principles defined in CLAUDE.md.

## Current State Analysis

### What Exists
- Basic `sync_state` table tracking only:
  - Last sync token
  - Last full sync timestamp
  - Last incremental sync timestamp
- Cron job running sync every 5 minutes
- Console logging for errors (not persisted)

### What's Missing
- No persistent sync event history
- No error tracking or retry mechanisms
- No health monitoring queries
- No performance metrics
- No audit trail for debugging

## Implementation Design

### 1. Database Schema Extensions

Add the following tables to `convex/schema.ts`:

```typescript
// Track each sync event
sync_events: defineTable({
  service: v.string(),
  sync_type: v.union(v.literal("full"), v.literal("incremental"), v.literal("webhook")),
  status: v.union(v.literal("started"), v.literal("success"), v.literal("failed")),
  started_at: v.string(),
  completed_at: v.optional(v.string()),
  duration_ms: v.optional(v.number()),
  items_processed: v.optional(v.number()),
  error_message: v.optional(v.string()),
  error_code: v.optional(v.string()),
  sync_token_before: v.optional(v.string()),
  sync_token_after: v.optional(v.string()),
})
  .index("by_service_and_time", ["service", "started_at"])
  .index("by_status", ["service", "status"]),

// Aggregate sync metrics
sync_metrics: defineTable({
  service: v.string(),
  metric_type: v.string(), // "hourly", "daily", "weekly"
  period_start: v.string(),
  successful_syncs: v.number(),
  failed_syncs: v.number(),
  total_items_synced: v.number(),
  average_duration_ms: v.number(),
  error_rate: v.number(),
  last_updated: v.string(),
})
  .index("by_service_and_type", ["service", "metric_type"])
  .index("by_period", ["service", "period_start"]),

// Track sync errors for retry logic
sync_errors: defineTable({
  service: v.string(),
  error_type: v.string(),
  error_message: v.string(),
  error_details: v.optional(v.any()),
  retry_count: v.number(),
  next_retry_at: v.optional(v.string()),
  resolved_at: v.optional(v.string()),
  created_at: v.string(),
})
  .index("by_service", ["service", "resolved_at"])
  .index("pending_retries", ["service", "next_retry_at"]),

// Enhanced sync_state table
sync_state: defineTable({
  service: v.string(),
  last_sync_token: v.optional(v.string()),
  last_full_sync: v.string(),
  last_incremental_sync: v.optional(v.string()),
  last_successful_sync: v.optional(v.string()),
  last_failed_sync: v.optional(v.string()),
  consecutive_failures: v.number(),
  is_healthy: v.boolean(),
  health_check_at: v.string(),
}).index("by_service", ["service"]),
```

### 2. Monitoring Module (`convex/todoist/monitoring.ts`)

Create comprehensive monitoring queries:

```typescript
import { query } from "../_generated/server";
import { v } from "convex/values";

export const getServiceHealth = query({
  handler: async (ctx) => {
    const syncState = await ctx.db
      .query("sync_state")
      .withIndex("by_service", q => q.eq("service", "todoist"))
      .first();
    
    const recentEvents = await ctx.db
      .query("sync_events")
      .withIndex("by_service_and_time", q => q.eq("service", "todoist"))
      .order("desc")
      .take(10);
    
    const activeErrors = await ctx.db
      .query("sync_errors")
      .withIndex("by_service", q => 
        q.eq("service", "todoist")
         .eq("resolved_at", undefined)
      )
      .collect();
    
    const now = Date.now();
    const lastSync = new Date(syncState?.last_successful_sync || 0).getTime();
    const timeSinceSync = now - lastSync;
    
    return {
      status: determineHealthStatus(timeSinceSync, syncState?.consecutive_failures || 0),
      lastSync: syncState?.last_successful_sync,
      nextSync: calculateNextSync(syncState),
      consecutiveFailures: syncState?.consecutive_failures || 0,
      isHealthy: syncState?.is_healthy ?? true,
      metrics: {
        totalSyncs: recentEvents.length,
        successRate: calculateSuccessRate(recentEvents),
        averageDuration: calculateAverageDuration(recentEvents),
        activeErrors: activeErrors.length,
      },
      alerts: generateHealthAlerts(timeSinceSync, syncState, activeErrors),
    };
  }
});

export const getRecentSyncEvents = query({
  args: { 
    limit: v.optional(v.number()),
    status: v.optional(v.union(v.literal("success"), v.literal("failed"))),
  },
  handler: async (ctx, { limit = 20, status }) => {
    let query = ctx.db
      .query("sync_events")
      .withIndex("by_service_and_time", q => q.eq("service", "todoist"))
      .order("desc");
    
    const events = await query.take(limit);
    
    return events
      .filter(e => !status || e.status === status)
      .map(event => ({
        ...event,
        duration: event.duration_ms ? `${event.duration_ms}ms` : "N/A",
        itemsPerSecond: event.items_processed && event.duration_ms 
          ? (event.items_processed / (event.duration_ms / 1000)).toFixed(2)
          : "N/A",
      }));
  }
});

export const getSyncMetrics = query({
  args: { 
    period: v.union(v.literal("hour"), v.literal("day"), v.literal("week")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { period, limit = 24 }) => {
    const metricType = period === "hour" ? "hourly" : period === "day" ? "daily" : "weekly";
    
    const metrics = await ctx.db
      .query("sync_metrics")
      .withIndex("by_service_and_type", q => 
        q.eq("service", "todoist")
         .eq("metric_type", metricType)
      )
      .order("desc")
      .take(limit);
    
    return {
      period,
      metrics: metrics.map(m => ({
        time: m.period_start,
        successRate: ((m.successful_syncs / (m.successful_syncs + m.failed_syncs)) * 100).toFixed(2),
        totalSyncs: m.successful_syncs + m.failed_syncs,
        averageDuration: `${m.average_duration_ms}ms`,
        itemsSynced: m.total_items_synced,
      })),
      summary: calculatePeriodSummary(metrics),
    };
  }
});

export const getErrorReport = query({
  args: { 
    includeResolved: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { includeResolved = false, limit = 50 }) => {
    const errors = await ctx.db
      .query("sync_errors")
      .withIndex("by_service", q => {
        const base = q.eq("service", "todoist");
        return includeResolved ? base : base.eq("resolved_at", undefined);
      })
      .order("desc")
      .take(limit);
    
    return {
      total: errors.length,
      unresolved: errors.filter(e => !e.resolved_at).length,
      byType: groupErrorsByType(errors),
      errors: errors.map(e => ({
        ...e,
        timeAgo: getTimeAgo(e.created_at),
        nextRetryIn: e.next_retry_at ? getTimeUntil(e.next_retry_at) : null,
      })),
    };
  }
});

export const getIntegrationDashboard = query({
  handler: async (ctx) => {
    const [health, recentSync, metrics, errors] = await Promise.all([
      ctx.runQuery(api.todoist.monitoring.getServiceHealth),
      ctx.runQuery(api.todoist.monitoring.getRecentSyncEvents, { limit: 1 }),
      ctx.runQuery(api.todoist.monitoring.getSyncMetrics, { period: "hour", limit: 1 }),
      ctx.runQuery(api.todoist.monitoring.getErrorReport, { includeResolved: false }),
    ]);
    
    return {
      overview: {
        status: health.status,
        lastSync: health.lastSync,
        uptime: calculateUptime(health),
        itemsInDatabase: await ctx.db.query("todoist_items").count(),
      },
      performance: {
        lastSyncDuration: recentSync[0]?.duration || "N/A",
        averageSyncTime: metrics.metrics[0]?.averageDuration || "N/A",
        syncFrequency: "5 minutes",
        successRate: health.metrics.successRate,
      },
      health: {
        isHealthy: health.isHealthy,
        consecutiveFailures: health.consecutiveFailures,
        activeErrors: errors.unresolved,
        alerts: health.alerts,
      },
      recentActivity: recentSync,
    };
  }
});
```

### 3. Sync Event Mutations (`convex/todoist/mutations.ts` additions)

Add mutations to track sync lifecycle:

```typescript
export const recordSyncStart = internalMutation({
  args: {
    sync_type: v.union(v.literal("full"), v.literal("incremental"), v.literal("webhook")),
    sync_token: v.optional(v.string()),
  },
  handler: async (ctx, { sync_type, sync_token }) => {
    const eventId = await ctx.db.insert("sync_events", {
      service: "todoist",
      sync_type,
      status: "started",
      started_at: new Date().toISOString(),
      sync_token_before: sync_token,
    });
    
    return eventId;
  }
});

export const recordSyncComplete = internalMutation({
  args: {
    event_id: v.id("sync_events"),
    items_processed: v.number(),
    sync_token_after: v.optional(v.string()),
  },
  handler: async (ctx, { event_id, items_processed, sync_token_after }) => {
    const event = await ctx.db.get(event_id);
    if (!event) throw new Error("Sync event not found");
    
    const now = new Date();
    const duration = now.getTime() - new Date(event.started_at).getTime();
    
    // Update event
    await ctx.db.patch(event_id, {
      status: "success",
      completed_at: now.toISOString(),
      duration_ms: duration,
      items_processed,
      sync_token_after,
    });
    
    // Update sync state
    const syncState = await ctx.db
      .query("sync_state")
      .withIndex("by_service", q => q.eq("service", "todoist"))
      .first();
    
    if (syncState) {
      await ctx.db.patch(syncState._id, {
        last_successful_sync: now.toISOString(),
        consecutive_failures: 0,
        is_healthy: true,
        health_check_at: now.toISOString(),
      });
    }
    
    // Update metrics (simplified - in production, aggregate properly)
    await updateSyncMetrics(ctx, "success", duration, items_processed);
  }
});

export const recordSyncError = internalMutation({
  args: {
    event_id: v.id("sync_events"),
    error: v.object({
      message: v.string(),
      code: v.optional(v.string()),
      details: v.optional(v.any()),
    }),
  },
  handler: async (ctx, { event_id, error }) => {
    const event = await ctx.db.get(event_id);
    if (!event) throw new Error("Sync event not found");
    
    const now = new Date();
    const duration = now.getTime() - new Date(event.started_at).getTime();
    
    // Update event
    await ctx.db.patch(event_id, {
      status: "failed",
      completed_at: now.toISOString(),
      duration_ms: duration,
      error_message: error.message,
      error_code: error.code,
    });
    
    // Update sync state
    const syncState = await ctx.db
      .query("sync_state")
      .withIndex("by_service", q => q.eq("service", "todoist"))
      .first();
    
    if (syncState) {
      const failures = (syncState.consecutive_failures || 0) + 1;
      await ctx.db.patch(syncState._id, {
        last_failed_sync: now.toISOString(),
        consecutive_failures: failures,
        is_healthy: failures < 3, // Unhealthy after 3 consecutive failures
        health_check_at: now.toISOString(),
      });
    }
    
    // Create error record
    await ctx.db.insert("sync_errors", {
      service: "todoist",
      error_type: error.code || "UNKNOWN",
      error_message: error.message,
      error_details: error.details,
      retry_count: 0,
      created_at: now.toISOString(),
    });
    
    // Update metrics
    await updateSyncMetrics(ctx, "failure", duration, 0);
  }
});

export const scheduleSyncRetry = internalMutation({
  args: {
    error_id: v.id("sync_errors"),
    retry_delay_ms: v.number(),
  },
  handler: async (ctx, { error_id, retry_delay_ms }) => {
    const error = await ctx.db.get(error_id);
    if (!error) return;
    
    const nextRetry = new Date(Date.now() + retry_delay_ms);
    
    await ctx.db.patch(error_id, {
      retry_count: error.retry_count + 1,
      next_retry_at: nextRetry.toISOString(),
    });
  }
});

export const markErrorResolved = internalMutation({
  args: {
    error_id: v.id("sync_errors"),
  },
  handler: async (ctx, { error_id }) => {
    await ctx.db.patch(error_id, {
      resolved_at: new Date().toISOString(),
    });
  }
});
```

### 4. Enhanced Sync Process

Update `sync.ts` to integrate monitoring:

```typescript
export const performIncrementalSync = action({
  args: {
    retry_count: v.optional(v.number()),
    error_id: v.optional(v.id("sync_errors")),
  },
  handler: async (ctx, { retry_count = 0, error_id }) => {
    console.log(`Starting incremental sync (attempt ${retry_count + 1})...`);
    
    // Record sync start
    const eventId = await ctx.runMutation(
      internal.todoist.mutations.recordSyncStart,
      { 
        sync_type: "incremental",
        sync_token: syncState?.last_sync_token,
      }
    );
    
    try {
      // ... existing sync logic ...
      
      // Record success
      await ctx.runMutation(
        internal.todoist.mutations.recordSyncComplete,
        { 
          event_id: eventId,
          items_processed: changeCount,
          sync_token_after: syncData.sync_token,
        }
      );
      
      // Mark any related error as resolved
      if (error_id) {
        await ctx.runMutation(
          internal.todoist.mutations.markErrorResolved,
          { error_id }
        );
      }
      
      return {
        success: true,
        changeCount,
        syncToken: syncData.sync_token,
      };
      
    } catch (error) {
      console.error(`Sync failed (attempt ${retry_count + 1}):`, error);
      
      // Record failure
      await ctx.runMutation(
        internal.todoist.mutations.recordSyncError,
        { 
          event_id: eventId,
          error: {
            message: error.message,
            code: error.code || determineErrorCode(error),
            details: {
              retry_count,
              stack: error.stack,
              response_status: error.status,
            },
          },
        }
      );
      
      // Determine if we should retry
      if (shouldRetry(error, retry_count)) {
        const delay = getRetryDelay(retry_count);
        console.log(`Scheduling retry in ${delay}ms...`);
        
        // Create or update error record for retry tracking
        const errorRecord = error_id ? await ctx.runQuery(
          internal.todoist.queries.getError,
          { error_id }
        ) : null;
        
        const newErrorId = error_id || await ctx.runMutation(
          internal.todoist.mutations.createSyncError,
          { error }
        );
        
        await ctx.runMutation(
          internal.todoist.mutations.scheduleSyncRetry,
          { 
            error_id: newErrorId,
            retry_delay_ms: delay,
          }
        );
        
        // Schedule the retry
        await ctx.scheduler.runAfter(
          delay,
          internal.todoist.sync.performIncrementalSync,
          { 
            retry_count: retry_count + 1,
            error_id: newErrorId,
          }
        );
      }
      
      throw error;
    }
  }
});

// Helper functions
function shouldRetry(error: any, retryCount: number): boolean {
  const MAX_RETRIES = 5;
  
  // Don't retry if we've hit the limit
  if (retryCount >= MAX_RETRIES) return false;
  
  // Retry on network errors
  if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") return true;
  
  // Retry on 5xx errors
  if (error.status >= 500) return true;
  
  // Retry on rate limits with backoff
  if (error.status === 429) return true;
  
  // Don't retry on auth errors or bad requests
  if (error.status === 401 || error.status === 400) return false;
  
  // Default to retry for unknown errors
  return true;
}

function getRetryDelay(retryCount: number): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s
  const delays = [1000, 2000, 4000, 8000, 16000];
  return delays[Math.min(retryCount, delays.length - 1)];
}

function determineErrorCode(error: any): string {
  if (error.code) return error.code;
  if (error.status) return `HTTP_${error.status}`;
  if (error.message.includes("network")) return "NETWORK_ERROR";
  if (error.message.includes("timeout")) return "TIMEOUT";
  return "UNKNOWN_ERROR";
}
```

### 5. Debug Queries (`convex/todoist/debug.ts`)

Add debugging utilities:

```typescript
export const getRecentWebhooks = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 20 }) => {
    return ctx.db
      .query("sync_events")
      .withIndex("by_service_and_time", q => 
        q.eq("service", "todoist")
         .eq("sync_type", "webhook")
      )
      .order("desc")
      .take(limit);
  }
});

export const getSyncTimeline = query({
  args: { 
    hours: v.optional(v.number()),
  },
  handler: async (ctx, { hours = 24 }) => {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    
    const events = await ctx.db
      .query("sync_events")
      .withIndex("by_service_and_time", q => 
        q.eq("service", "todoist")
         .gte("started_at", since)
      )
      .collect();
    
    // Group by hour for visualization
    const timeline = groupEventsByHour(events);
    
    return {
      period: `Last ${hours} hours`,
      totalSyncs: events.length,
      successfulSyncs: events.filter(e => e.status === "success").length,
      failedSyncs: events.filter(e => e.status === "failed").length,
      timeline,
    };
  }
});

export const analyzeSyncPerformance = query({
  handler: async (ctx) => {
    const recentSyncs = await ctx.db
      .query("sync_events")
      .withIndex("by_service_and_time", q => q.eq("service", "todoist"))
      .order("desc")
      .take(100);
    
    const successful = recentSyncs.filter(s => s.status === "success");
    const durations = successful
      .map(s => s.duration_ms)
      .filter(d => d !== undefined) as number[];
    
    return {
      sampleSize: durations.length,
      performance: {
        min: Math.min(...durations),
        max: Math.max(...durations),
        average: durations.reduce((a, b) => a + b, 0) / durations.length,
        median: calculateMedian(durations),
      },
      itemsProcessed: {
        total: successful.reduce((sum, s) => sum + (s.items_processed || 0), 0),
        average: successful.reduce((sum, s) => sum + (s.items_processed || 0), 0) / successful.length,
      },
      performanceByType: groupPerformanceByType(recentSyncs),
    };
  }
});
```

### 6. Testing Strategy

```typescript
// convex/todoist/__tests__/monitoring.test.ts

describe("Sync Monitoring", () => {
  test("records successful sync events");
  test("tracks consecutive failures");
  test("calculates health status correctly");
  test("handles retry logic with exponential backoff");
  test("aggregates metrics accurately");
  test("identifies performance degradation");
  test("alerts on critical failures");
});
```

## Usage Examples

### Check Integration Health
```bash
npx convex run todoist:monitoring.getServiceHealth
```

### View Recent Sync History
```bash
npx convex run todoist:monitoring.getRecentSyncEvents --limit 20
```

### Get Performance Metrics
```bash
npx convex run todoist:monitoring.getSyncMetrics --period hour
```

### Debug Failed Syncs
```bash
npx convex run todoist:monitoring.getErrorReport
```

### View Full Dashboard
```bash
npx convex run todoist:monitoring.getIntegrationDashboard
```

## Benefits

1. **Complete Visibility**: Every sync attempt is tracked with detailed metrics
2. **Proactive Monitoring**: Health checks identify issues before they become critical
3. **Smart Retry Logic**: Exponential backoff prevents overwhelming failed services
4. **Performance Tracking**: Identify slowdowns and optimize sync performance
5. **Debugging Support**: Rich query interface for investigating issues
6. **Alerting Ready**: Health alerts can trigger notifications
7. **Audit Compliance**: Complete audit trail of all data sync operations

## Future Enhancements

1. **Metric Aggregation Job**: Periodic job to roll up hourly metrics to daily/weekly
2. **Alert Notifications**: Send alerts via webhook/email on critical failures
3. **Performance Optimization**: Auto-adjust sync frequency based on metrics
4. **Data Freshness Tracking**: Monitor staleness of individual data types
5. **Sync Comparison**: Compare sync performance across different services
6. **Export Capabilities**: Export sync logs for external analysis

## Implementation Priority

1. **Phase 1**: Core monitoring (schema, basic mutations, event logging)
2. **Phase 2**: Health queries and dashboard
3. **Phase 3**: Retry logic and error handling
4. **Phase 4**: Performance metrics and aggregation
5. **Phase 5**: Advanced debugging and alerting

This monitoring system will provide the robust observability needed to maintain high data integrity and quickly identify/resolve any sync issues.