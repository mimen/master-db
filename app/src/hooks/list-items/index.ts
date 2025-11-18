/**
 * List Items Hooks
 *
 * Shared hooks for list item components (Tasks, Projects, Routines).
 * These hooks extract common patterns to reduce code duplication.
 *
 * @example
 * ```tsx
 * import {
 *   useListItemFocus,
 *   useListItemHover,
 *   useListItemEditing,
 *   useOptimisticSync
 * } from '@/hooks/list-items'
 * ```
 */

export { useListItemFocus } from './useListItemFocus'
export { useListItemHover } from './useListItemHover'
export { useListItemEditing } from './useListItemEditing'
export { useOptimisticSync } from './useOptimisticSync'
