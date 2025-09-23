/**
 * Todoist Priority System
 *
 * IMPORTANT: Todoist's API uses an inverted priority system compared to their UI:
 * - API Priority 4 = UI P1 (Highest Priority) - Red
 * - API Priority 3 = UI P2 (High Priority) - Orange
 * - API Priority 2 = UI P3 (Medium Priority) - Blue
 * - API Priority 1 = UI P4 (Normal Priority) - No flag
 *
 * This file provides canonical mappings to prevent confusion.
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
 * Convert API priority to UI priority (P1, P2, P3, P4)
 */
export function apiToUiPriority(apiPriority?: number): TodoistUiPriority | null {
  const info = getPriorityInfo(apiPriority);
  return info?.uiPriority || null;
}

/**
 * Convert UI priority to API priority
 */
export function uiToApiPriority(uiPriority: TodoistUiPriority): TodoistApiPriority {
  const entry = Object.values(PRIORITY_MAP).find(p => p.uiPriority === uiPriority);
  if (!entry) {
    throw new Error(`Invalid UI priority: ${uiPriority}`);
  }
  return entry.apiPriority;
}

/**
 * Check if priority should show a flag
 */
export function shouldShowFlag(apiPriority?: number): boolean {
  const info = getPriorityInfo(apiPriority);
  return info?.showFlag || false;
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