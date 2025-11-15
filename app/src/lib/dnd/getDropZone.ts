import type { DropZone, DropPosition, VerticalPosition, ProjectTreeNode } from "./types";

/**
 * Calculate drop zone based on mouse position over a project element
 *
 * Horizontal zones (user requirements):
 * - Left 25%: Outdent (move outside parent group, only when last child)
 * - Middle 50%: Sibling (same level as target)
 * - Right 25%: Child (indent one level deeper)
 *
 * Vertical zones:
 * - Top 50%: Insert before target
 * - Bottom 50%: Insert after target
 * - Exception: Right zone (child) always uses "inside" vertical position
 */
export function getDropZone(params: {
  /** Mouse X coordinate (relative to viewport) */
  mouseX: number;

  /** Mouse Y coordinate (relative to viewport) */
  mouseY: number;

  /** Bounding rect of the target project element */
  projectRect: DOMRect;

  /** Target project being hovered over */
  targetProject: ProjectTreeNode;

  /** All projects in the tree (for parent/sibling lookup) */
  allProjects: ProjectTreeNode[];
}): DropZone {
  const { mouseX, mouseY, projectRect, targetProject, allProjects } = params;

  // Calculate horizontal position (left/middle/right)
  const relativeX = mouseX - projectRect.left;
  const width = projectRect.width;
  const horizontalPercent = relativeX / width;

  // Calculate vertical position (before/after)
  const relativeY = mouseY - projectRect.top;
  const height = projectRect.height;
  const verticalPercent = relativeY / height;

  let position: DropPosition;
  let vertical: VerticalPosition;
  let newLevel: number;
  let newParentId: string | null;

  // Determine horizontal drop zone
  if (horizontalPercent < 0.25 && targetProject.isLastInGroup && targetProject.level > 0) {
    // LEFT ZONE: Outdent (only valid when last child of a parent)
    position = "left";
    vertical = "after"; // Always after when outdenting
    newLevel = targetProject.level - 1;

    // Find target's parent, then get parent's parent
    const targetParent = allProjects.find((p) => p.id === targetProject.parentId);
    newParentId = targetParent?.parentId ?? null;
  } else if (horizontalPercent >= 0.75) {
    // RIGHT ZONE: Make child (indent)
    position = "right";
    vertical = "inside";
    newLevel = targetProject.level + 1;
    newParentId = targetProject.id;
  } else {
    // MIDDLE ZONE: Sibling (same level)
    position = "middle";
    vertical = verticalPercent < 0.5 ? "before" : "after";
    newLevel = targetProject.level;
    newParentId = targetProject.parentId;
  }

  // Calculate new child_order within siblings
  const siblings = allProjects.filter((p) => p.parentId === newParentId);
  siblings.sort((a, b) => a.childOrder - b.childOrder);

  let newChildOrder: number;

  if (position === "right") {
    // Becoming first child of target
    newChildOrder = 0;
  } else if (vertical === "before") {
    // Insert before target in sibling list
    const targetIndex = siblings.findIndex((p) => p.id === targetProject.id);
    newChildOrder = targetIndex >= 0 ? siblings[targetIndex].childOrder : 0;
  } else {
    // Insert after target in sibling list (or after parent when outdenting)
    let targetForAfter: ProjectTreeNode;
    if (position === "left") {
      // When outdenting, insert after parent
      const targetParent = allProjects.find((p) => p.id === targetProject.parentId);
      targetForAfter = targetParent ?? targetProject;
    } else {
      targetForAfter = targetProject;
    }

    const targetIndex = siblings.findIndex((p) => p.id === targetForAfter.id);
    if (targetIndex >= 0 && targetIndex < siblings.length - 1) {
      newChildOrder = siblings[targetIndex + 1].childOrder;
    } else {
      // Insert at end
      newChildOrder = siblings.length > 0 ? Math.max(...siblings.map((s) => s.childOrder)) + 1 : 0;
    }
  }

  return {
    position,
    vertical,
    targetProjectId: targetProject.id,
    newLevel,
    newParentId,
    newChildOrder,
  };
}
