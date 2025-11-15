/**
 * Status types for routine tasks
 * Tracks the lifecycle of a generated task
 */

export const RoutineTaskStatus = {
  Pending: "pending",       // Task created, awaiting completion
  Completed: "completed",   // Task completed on time
  Missed: "missed",         // Task overdue and marked as missed
  Skipped: "skipped",       // Task manually deleted in Todoist
  Deferred: "deferred",     // Routine was deferred, task cancelled
} as const;

export type RoutineTaskStatusType =
  (typeof RoutineTaskStatus)[keyof typeof RoutineTaskStatus];

/**
 * Check if status is terminal (won't change)
 */
export function isTerminalStatus(status: RoutineTaskStatusType): boolean {
  return (
    status === RoutineTaskStatus.Completed ||
    status === RoutineTaskStatus.Missed ||
    status === RoutineTaskStatus.Skipped ||
    status === RoutineTaskStatus.Deferred
  );
}

/**
 * Check if status counts toward completion rate
 */
export function countsTowardCompletion(status: RoutineTaskStatusType): boolean {
  return (
    status === RoutineTaskStatus.Completed ||
    status === RoutineTaskStatus.Missed ||
    status === RoutineTaskStatus.Skipped
  );
}

/**
 * Get display name for status
 */
export function getStatusDisplay(status: RoutineTaskStatusType): string {
  switch (status) {
    case RoutineTaskStatus.Pending:
      return "Pending";
    case RoutineTaskStatus.Completed:
      return "Completed";
    case RoutineTaskStatus.Missed:
      return "Missed";
    case RoutineTaskStatus.Skipped:
      return "Skipped";
    case RoutineTaskStatus.Deferred:
      return "Deferred";
    default:
      const _exhaustive: never = status;
      throw new Error(`Unknown status: ${_exhaustive}`);
  }
}

/**
 * Get color class for status (for UI display)
 */
export function getStatusColor(
  status: RoutineTaskStatusType
): "green" | "red" | "gray" | "blue" | "yellow" {
  switch (status) {
    case RoutineTaskStatus.Completed:
      return "green";
    case RoutineTaskStatus.Missed:
      return "red";
    case RoutineTaskStatus.Skipped:
      return "gray";
    case RoutineTaskStatus.Deferred:
      return "gray";
    case RoutineTaskStatus.Pending:
      return "blue";
    default:
      const _exhaustive: never = status;
      throw new Error(`Unknown status: ${_exhaustive}`);
  }
}
