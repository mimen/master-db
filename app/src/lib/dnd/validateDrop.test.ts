import { describe, it, expect } from "vitest";
import { validateDrop, getProjectDepth, getSubtreeDepth, isDescendantOf } from "./validateDrop";
import { DropValidationCode } from "./types";
import type { DropZone, ProjectTreeNode } from "./types";

// Test data: 3-level hierarchy
// Root
//   ├─ Parent (level 1)
//   │   ├─ Child (level 2)
//   │   └─ LastChild (level 2, last in group)
//   └─ Parent2 (level 1)

// Create minimal mock projects with required fields
const createMockProject = (overrides: Partial<ProjectTreeNode> & { todoist_id: string }): ProjectTreeNode => ({
  _id: "" as any,
  _creationTime: 0,
  todoist_id: overrides.todoist_id,
  name: overrides.name || "Test",
  color: "blue",
  parent_id: overrides.parent_id || null,
  child_order: overrides.child_order ?? 0,
  is_deleted: false,
  is_archived: false,
  is_favorite: false,
  view_style: "list",
  children: overrides.children || [],
  level: overrides.level,
  isLastInGroup: overrides.isLastInGroup,
  stats: { activeCount: 0, completedCount: 0 },
  ...overrides,
} as ProjectTreeNode);

const mockProjects: ProjectTreeNode[] = [
  createMockProject({
    todoist_id: "root",
    name: "Root",
    parent_id: null,
    child_order: 0,
    level: 0,
    isLastInGroup: false,
  }),
  createMockProject({
    todoist_id: "parent",
    name: "Parent",
    parent_id: null,
    child_order: 1,
    level: 0,
    isLastInGroup: false,
  }),
  createMockProject({
    todoist_id: "child",
    name: "Child",
    parent_id: "parent",
    child_order: 0,
    level: 1,
    isLastInGroup: false,
  }),
  createMockProject({
    todoist_id: "lastChild",
    name: "Last Child",
    parent_id: "parent",
    child_order: 1,
    level: 1,
    isLastInGroup: true,
  }),
  createMockProject({
    todoist_id: "parent2",
    name: "Parent 2",
    parent_id: null,
    child_order: 2,
    level: 0,
    isLastInGroup: false,
  }),
];

describe("getProjectDepth", () => {
  it("should return 0 for root level projects", () => {
    const root = mockProjects.find((p) => p.todoist_id === "root")!;
    expect(getProjectDepth(root, mockProjects)).toBe(0);
  });

  it("should return 1 for child projects", () => {
    const child = mockProjects.find((p) => p.todoist_id === "child")!;
    expect(getProjectDepth(child, mockProjects)).toBe(1);
  });
});

describe("getSubtreeDepth", () => {
  it("should return 0 for projects with no children", () => {
    const child = mockProjects.find((p) => p.todoist_id === "child")!;
    expect(getSubtreeDepth(child, mockProjects)).toBe(0);
  });

  it("should return 1 for projects with children", () => {
    const parent = mockProjects.find((p) => p.todoist_id === "parent")!;
    expect(getSubtreeDepth(parent, mockProjects)).toBe(1);
  });
});

describe("isDescendantOf", () => {
  it("should return true for direct child", () => {
    const child = mockProjects.find((p) => p.todoist_id === "child")!;
    const parent = mockProjects.find((p) => p.todoist_id === "parent")!;
    expect(isDescendantOf(child, parent, mockProjects)).toBe(true);
  });

  it("should return false for non-descendant", () => {
    const parent = mockProjects.find((p) => p.todoist_id === "parent")!;
    const parent2 = mockProjects.find((p) => p.todoist_id === "parent2")!;
    expect(isDescendantOf(parent2, parent, mockProjects)).toBe(false);
  });

  it("should return false for self", () => {
    const parent = mockProjects.find((p) => p.todoist_id === "parent")!;
    expect(isDescendantOf(parent, parent, mockProjects)).toBe(false);
  });
});

describe("validateDrop", () => {
  it("should reject same position drop", () => {
    const draggedProject = mockProjects.find((p) => p.todoist_id === "child")!;
    const dropZone: DropZone = {
      position: "middle",
      vertical: "before",
      targetProjectId: "child",
      newLevel: 1,
      newParentId: "parent",
      newChildOrder: 0,
    };

    const result = validateDrop({ draggedProject, dropZone, allProjects: mockProjects });
    expect(result.valid).toBe(false);
    expect(result.code).toBe(DropValidationCode.SAME_POSITION);
  });

  it("should reject circular reference (parent into child)", () => {
    const draggedProject = mockProjects.find((p) => p.todoist_id === "parent")!;
    const dropZone: DropZone = {
      position: "right",
      vertical: "inside",
      targetProjectId: "child",
      newLevel: 2,
      newParentId: "child",
      newChildOrder: 0,
    };

    const result = validateDrop({ draggedProject, dropZone, allProjects: mockProjects });
    expect(result.valid).toBe(false);
    expect(result.code).toBe(DropValidationCode.CIRCULAR_REFERENCE);
  });

  it("should reject depth limit exceeded", () => {
    // Create a deeper hierarchy for this test
    const deepProjects: ProjectTreeNode[] = [
      ...mockProjects,
      createMockProject({
        todoist_id: "grandchild",
        name: "Grandchild",
        parent_id: "child",
        child_order: 0,
        level: 2,
        isLastInGroup: false,
      }),
    ];

    const draggedProject = deepProjects.find((p) => p.todoist_id === "child")!; // Has 1 level of children (grandchild)
    const dropZone: DropZone = {
      position: "right",
      vertical: "inside",
      targetProjectId: "lastChild", // lastChild is at level 1
      newLevel: 2, // Would become level 2
      newParentId: "lastChild",
      newChildOrder: 0,
    };

    // Dragged project (child) has grandchild at level 1 relative to it
    // Target is level 2, so grandchild would be at level 3 (exceeds max of 2)
    const result = validateDrop({ draggedProject, dropZone, allProjects: deepProjects });
    expect(result.valid).toBe(false);
    expect(result.code).toBe(DropValidationCode.DEPTH_LIMIT);
  });

  it("should allow valid drops", () => {
    const draggedProject = mockProjects.find((p) => p.todoist_id === "child")!;
    const dropZone: DropZone = {
      position: "middle",
      vertical: "after",
      targetProjectId: "parent2",
      newLevel: 0,
      newParentId: null,
      newChildOrder: 3,
    };

    const result = validateDrop({ draggedProject, dropZone, allProjects: mockProjects });
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
