import type { DropZone, DropValidation, ProjectTreeNode, DropValidationCode } from "./types";
import { DropValidationCode as Code } from "./types";

/**
 * Validate whether a drop operation is allowed
 *
 * Checks:
 * 1. Not dropping on self in same position
 * 2. No circular references (parent into own child)
 * 3. Depth limit not exceeded (max 3 levels)
 */
export function validateDrop(params: {
  /** Project being dragged */
  draggedProject: ProjectTreeNode;

  /** Calculated drop zone */
  dropZone: DropZone;

  /** All projects in the tree */
  allProjects: ProjectTreeNode[];
}): DropValidation {
  const { draggedProject, dropZone, allProjects } = params;

  // Check 1: Same position (no-op)
  if (
    draggedProject.id === dropZone.targetProjectId &&
    draggedProject.parentId === dropZone.newParentId &&
    draggedProject.childOrder === dropZone.newChildOrder
  ) {
    return {
      valid: false,
      reason: "Already in this position",
      code: Code.SAME_POSITION,
    };
  }

  // Check 2: Circular reference (parent into own descendant)
  const targetProject = allProjects.find((p) => p.id === dropZone.targetProjectId);
  if (!targetProject) {
    return {
      valid: false,
      reason: "Invalid target project",
      code: Code.INVALID_TARGET,
    };
  }

  if (isDescendantOf(targetProject, draggedProject, allProjects)) {
    return {
      valid: false,
      reason: "Cannot move project into its own descendant",
      code: Code.CIRCULAR_REFERENCE,
    };
  }

  // Check 3: Depth limit (max 3 levels: 0, 1, 2)
  const draggedSubtreeDepth = getSubtreeDepth(draggedProject, allProjects);
  const targetDepth = dropZone.newLevel;

  if (targetDepth + draggedSubtreeDepth > 2) {
    return {
      valid: false,
      reason: `Maximum nesting depth is 3 levels (would create level ${targetDepth + draggedSubtreeDepth + 1})`,
      code: Code.DEPTH_LIMIT,
    };
  }

  // All checks passed
  return { valid: true };
}

/**
 * Get the depth of a project in the hierarchy
 * @returns 0 for root, 1 for child, 2 for grandchild
 */
export function getProjectDepth(project: ProjectTreeNode, allProjects: ProjectTreeNode[]): number {
  let depth = 0;
  let current: ProjectTreeNode | undefined = project;

  while (current?.parentId) {
    depth++;
    current = allProjects.find((p) => p.id === current!.parentId);
  }

  return depth;
}

/**
 * Get the maximum depth of a project's subtree
 * @returns 0 if no children, 1 if has children, 2 if has grandchildren
 */
export function getSubtreeDepth(project: ProjectTreeNode, allProjects: ProjectTreeNode[]): number {
  const children = allProjects.filter((p) => p.parentId === project.id);

  if (children.length === 0) {
    return 0;
  }

  const childDepths = children.map((child) => getSubtreeDepth(child, allProjects));
  return 1 + Math.max(...childDepths);
}

/**
 * Check if a project is a descendant of another project
 * Used to prevent circular references
 */
export function isDescendantOf(
  project: ProjectTreeNode,
  potentialAncestor: ProjectTreeNode,
  allProjects: ProjectTreeNode[]
): boolean {
  let current: ProjectTreeNode | undefined = project;

  while (current?.parentId) {
    if (current.parentId === potentialAncestor.id) {
      return true;
    }
    current = allProjects.find((p) => p.id === current!.parentId);
  }

  return false;
}

/**
 * Calculate new parent and child_order from drop zone
 * Helper for executing the move after validation
 */
export function getNewParentAndOrder(
  dropZone: DropZone
): { parentId: string | null; childOrder: number } {
  return {
    parentId: dropZone.newParentId,
    childOrder: dropZone.newChildOrder,
  };
}
