import {
  PRIORITY_MAP,
  apiToUiPriority,
  getPriorityColorClass,
  getPriorityInfo,
  shouldShowFlag,
  uiToApiPriority,
  type PriorityInfo,
  type TodoistApiPriority,
  type TodoistUiPriority,
} from "../../../convex/todoist/types/priorities";

/**
 * Priority utilities for React components.
 *
 * Re-export Convex's canonical priority definitions so the UI and backend stay in sync.
 */

export {
  PRIORITY_MAP,
  apiToUiPriority,
  getPriorityColorClass,
  getPriorityInfo,
  shouldShowFlag,
  uiToApiPriority,
  type PriorityInfo,
  type TodoistApiPriority,
  type TodoistUiPriority,
};

/**
 * React hook for getting priority information with UI-friendly helpers.
 */
export function usePriority(apiPriority?: number) {
  const info = getPriorityInfo(apiPriority);

  if (!info) return null;

  return {
    ...info,
    colorClass: getPriorityColorClass(apiPriority),
    label: info.uiPriority,
  };
}

export interface PriorityComponentProps {
  priority?: number;
  showFlag?: boolean;
  size?: "sm" | "md" | "lg";
}

export const PRIORITY_FLAG_SIZES = {
  sm: "w-2 h-2",
  md: "w-2.5 h-2.5",
  lg: "w-3 h-3",
} as const;
