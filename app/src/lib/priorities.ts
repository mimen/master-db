/**
 * Priority utilities for React components
 *
 * This ensures the UI layer uses the same canonical priority mapping as Convex.
 */

export type TodoistApiPriority = 1 | 2 | 3 | 4;
export type TodoistUiPriority = "P1" | "P2" | "P3" | "P4";

export interface PriorityInfo {
  apiPriority: TodoistApiPriority;
  uiPriority: TodoistUiPriority;
  displayName: string;
  level: "highest" | "high" | "medium" | "normal";
  color: "red" | "orange" | "blue" | null;
  showFlag: boolean;
}

/**
 * Canonical priority mapping from API priority to all related information
 * KEEP IN SYNC with convex/todoist/types/priorities.ts
 */
export const PRIORITY_MAP: Record<TodoistApiPriority, PriorityInfo> = {
  4: {
    apiPriority: 4,
    uiPriority: "P1",
    displayName: "P1 (Highest)",
    level: "highest",
    color: "red",
    showFlag: true,
  },
  3: {
    apiPriority: 3,
    uiPriority: "P2",
    displayName: "P2 (High)",
    level: "high",
    color: "orange",
    showFlag: true,
  },
  2: {
    apiPriority: 2,
    uiPriority: "P3",
    displayName: "P3 (Medium)",
    level: "medium",
    color: "blue",
    showFlag: true,
  },
  1: {
    apiPriority: 1,
    uiPriority: "P4",
    displayName: "P4 (Normal)",
    level: "normal",
    color: null,
    showFlag: false,
  },
};

/**
 * Get priority information from API priority value
 */
export function getPriorityInfo(apiPriority?: number): PriorityInfo | null {
  if (!apiPriority || !(apiPriority in PRIORITY_MAP)) {
    return null;
  }
  return PRIORITY_MAP[apiPriority as TodoistApiPriority];
}

/**
 * Get CSS color class for priority
 */
export function getPriorityColorClass(apiPriority?: number): string | null {
  const info = getPriorityInfo(apiPriority);
  if (!info?.color) return null;

  switch (info.color) {
    case "red": return "text-red-500";
    case "orange": return "text-orange-500";
    case "blue": return "text-blue-500";
    default: return null;
  }
}

/**
 * React hook for getting priority information
 *
 * @param apiPriority - Priority value from Todoist API (1-4)
 * @returns Priority information object or null if no priority
 *
 * @example
 * ```tsx
 * function ProjectItem({ project }) {
 *   const priority = usePriority(project.metadata?.priority);
 *
 *   return (
 *     <div>
 *       {priority?.showFlag && (
 *         <Flag className={cn("w-2.5 h-2.5", priority.colorClass)} />
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePriority(apiPriority?: number) {
  const info = getPriorityInfo(apiPriority);

  if (!info) return null;

  return {
    ...info,
    colorClass: getPriorityColorClass(apiPriority),
  };
}

/**
 * Component props for priority-aware components
 */
export interface PriorityComponentProps {
  priority?: number;
  showFlag?: boolean;
  size?: "sm" | "md" | "lg";
}

/**
 * Priority flag size classes
 */
export const PRIORITY_FLAG_SIZES = {
  sm: "w-2 h-2",
  md: "w-2.5 h-2.5",
  lg: "w-3 h-3",
} as const;