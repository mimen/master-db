/**
 * Drop zone types for hierarchical project drag-and-drop
 */

/**
 * Horizontal position within a project item
 * - left: Outdent (move outside parent group, only valid when last child)
 * - middle: Sibling (same level as target)
 * - right: Child (indent one level deeper)
 */
export type DropPosition = "left" | "middle" | "right";

/**
 * Vertical position relative to target
 * - before: Drop above target (insert before in sibling list)
 * - after: Drop below target (insert after in sibling list)
 * - inside: Drop into target (make child, only valid for right position)
 */
export type VerticalPosition = "before" | "after" | "inside";

/**
 * Drop zone calculation result
 */
export interface DropZone {
  /** Horizontal drop position */
  position: DropPosition;

  /** Vertical drop position */
  vertical: VerticalPosition;

  /** Target project ID being hovered over */
  targetProjectId: string;

  /** Resulting hierarchy level after drop (0 = root, 1 = child, 2 = grandchild) */
  newLevel: number;

  /** New parent ID after drop (null = root level) */
  newParentId: string | null;

  /** New child_order position within siblings */
  newChildOrder: number;
}

/**
 * Drop validation result
 */
export interface DropValidation {
  /** Whether drop is allowed */
  valid: boolean;

  /** Human-readable reason if invalid */
  reason?: string;

  /** Error code for programmatic handling */
  code?: DropValidationCode;
}

/**
 * Drop validation error codes
 */
export enum DropValidationCode {
  /** Dropping on self in same position */
  SAME_POSITION = "SAME_POSITION",

  /** Would create circular reference (parent into own child) */
  CIRCULAR_REFERENCE = "CIRCULAR_REFERENCE",

  /** Would exceed max nesting depth (3 levels) */
  DEPTH_LIMIT = "DEPTH_LIMIT",

  /** Invalid drop target */
  INVALID_TARGET = "INVALID_TARGET",
}

/**
 * Project tree node with hierarchy metadata
 * Used for drag-drop calculations
 */
export interface ProjectTreeNode {
  id: string;
  name: string;
  parentId: string | null;
  childOrder: number;
  level: number; // Calculated: 0 = root, 1 = child, 2 = grandchild
  children: ProjectTreeNode[];
  isLastInGroup: boolean; // Whether this is the last child of its parent
}
