// Barrel export for INTERNAL-ONLY queries
// Public queries are exported from publicQueries.ts instead

// Internal queries
export { getRawActiveItems } from "./internal/queries/getRawActiveItems";

// Note: The following queries are PUBLIC and exported from publicQueries.ts, not here:
// - getPriorityQueue, getFocusedTasks, getContextBatch, getQueueState
// - getProjectsByPriority
// - All time-based queries (getActiveItems, getDueTodayItems, etc.)
// - All filter count queries (getTimeFilterCounts, getPriorityFilterCounts, etc.)

// Note: The following are internal-only and NOT exported from barrel files
// to avoid type conflicts. Reference them directly from their modules:
// - internal.todoist.internal.queries.getSyncState.getSyncState
// - internal.todoist.queries.getItemByTodoistId.getItemByTodoistId
// - internal.todoist.queries.getWebhookEventByDeliveryId.getWebhookEventByDeliveryId