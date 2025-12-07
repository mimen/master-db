import type { SidebarConfig } from "./types"

/**
 * Sidebar configuration - single source of truth for sidebar structure
 *
 * This configuration defines all sections and their contents using view-keys.
 * Icons, titles, and counts are automatically retrieved from the ViewRegistry and CountRegistry.
 */
export const SIDEBAR_CONFIG: SidebarConfig = {
  sections: [
    {
      section: "primary",
      // No label = no section header
      items: [
        "view:inbox",
        "view:multi:priority-queue",
        "view:folders",
        "view:routines",
      ],
    },
    {
      section: "routineTasks",
      label: "Routine Tasks",
      items: [
        "view:routine-tasks:overdue",
        "view:routine-tasks:morning",
        "view:routine-tasks:night",
        "view:routine-tasks:todays",
        "view:routine-tasks:get-ahead",
      ],
    },
    {
      section: "folders",
      label: "Folders",
      sortOptions: [
        {
          key: "hierarchy",
          label: "Hierarchy",
          source: "projectsByHierarchy",
        },
        {
          key: "priority",
          label: "Priority",
          items: [
            "view:priority-projects:p1",
            "view:priority-projects:p2",
            "view:priority-projects:p3",
            "view:priority-projects:p4",
          ],
        },
        {
          key: "taskCount",
          label: "Task Count",
          source: "projectsByTaskCount",
        },
        {
          key: "alphabetical",
          label: "Alphabetical",
          source: "projectsByAlphabetical",
        },
      ],
    },
    {
      section: "time",
      label: "Time",
      items: [
        "view:time:overdue",
        "view:time:today",
        "view:time:upcoming",
        "view:time:no-date",
      ],
    },
    {
      section: "priorities",
      label: "Priorities",
      items: [
        "view:priority:p1",
        "view:priority:p2",
        "view:priority:p3",
        "view:priority:p4",
      ],
    },
    {
      section: "labels",
      label: "Labels",
      sortOptions: [
        {
          key: "taskCount",
          label: "Task Count",
          source: "labelsByTaskCount",
        },
        {
          key: "alphabetical",
          label: "Alphabetical",
          source: "labelsByAlphabetical",
        },
      ],
    },
  ],

  // Subview definitions (children for expandable views)
  subviews: {
    "view:multi:priority-queue": {
      items: [
        "view:time:overdue",
        "view:time:today",
        "view:inbox",
        "view:priority:p1",
        "view:priority-projects:p1",
        "view:priority-projects:p2",
        "view:time:upcoming",
      ],
    },
    "view:folders": {
      // Show folder type categories (Projects, Areas, Unassigned)
      items: [
        "view:folders:projects",
        "view:folders:areas",
        "view:folders:unassigned",
      ],
    },
    "view:routines": {
      // Sortable routine projects
      sortOptions: [
        {
          key: "flat",
          label: "Alphabetical",
          source: "routinesByFlat",
        },
        {
          key: "projectOrder",
          label: "Project Order",
          source: "routinesByProjectOrder",
        },
        {
          key: "routineCount",
          label: "Routine Count",
          source: "routinesByCount",
        },
      ],
    },
    "view:priority-projects:p1": {
      type: "generator",
      source: "projectsByPriority",
      params: { priority: 4 }, // API priority 4 = UI P1
    },
    "view:priority-projects:p2": {
      type: "generator",
      source: "projectsByPriority",
      params: { priority: 3 }, // API priority 3 = UI P2
    },
    "view:priority-projects:p3": {
      type: "generator",
      source: "projectsByPriority",
      params: { priority: 2 }, // API priority 2 = UI P3
    },
    "view:priority-projects:p4": {
      type: "generator",
      source: "projectsByPriority",
      params: { priority: 1 }, // API priority 1 = UI P4
    },
  },
}
