# Adding New Views - Quick Start Guide

**Purpose**: Step-by-step checklist for adding new views to the Convex-DB application

**Last Updated**: 2025-01-15

---

## 📋 Implementation Checklist

Use this checklist when adding any new view to the application. Each step includes the file location and what to add.

### Step 1: Define ViewKey Type
**File**: `app/src/lib/views/types.ts`

Add your view key to the `ViewKey` union type:

```typescript
export type ViewKey =
  | "view:inbox"
  | "view:projects"
  | "view:routines"
  | "view:your-new-view"  // ← Add here
  | `view:your-dynamic-view:${string}`  // For parameterized views
```

**Examples**:
- Static: `"view:archive"`
- Dynamic: `"view:tag:${string}"` (for tag-based views)

---

### Step 2: Create List Definition
**File**: `app/src/lib/views/listDefinitions.tsx`

Add a list definition that specifies how to query and display your view:

```typescript
export const listDefinitions = {
  // ... existing definitions

  yourView: {
    key: "your-view",
    defaults: {
      collapsible: false,
      startExpanded: true,
      maxTasks: undefined,
    },
    dependencies: {
      projects: true,  // If you need project data
      labels: true,    // If you need label data
    },
    buildQuery: (params) => ({
      type: "your-query-type",  // Add to ListQueryDefinition type
      timezoneOffsetMinutes: getTimezoneOffset(),
    }),
    getHeader: (context) => ({
      title: "Your View Title",
      icon: <YourIcon className="h-4 w-4" />,
    }),
    getEmptyState: (context) => ({
      title: "No items",
      description: "Description when empty",
    }),
  },
} as const
```

**Key Points**:
- `buildQuery()` - Defines what data to fetch
- `getHeader()` - Defines title and icon
- `getEmptyState()` - Defines empty state message
- `dependencies` - Declares what context data is needed

---

### Step 3: Register View Pattern
**File**: `app/src/lib/views/viewRegistry.tsx`

Add a pattern matcher and view builder:

```typescript
const viewPatterns: ViewPattern[] = [
  // ... existing patterns

  {
    match: (key) => key === "view:your-view",
    getDefinition: () => ({
      metadata: {
        title: "Your View",
        icon: getViewIcon("view:your-view", { size: "sm" }),
      },
      buildLists: (viewKey, index) =>
        expandYourView(viewKey, index),
    }),
  },
]

// Add expansion function
function expandYourView(
  viewKey: ViewKey,
  startIndex: number
): ListInstance[] {
  return [
    instantiateList(listDefinitions.yourView, {
      id: createListId(viewKey, "main"),
      viewKey,
      indexInView: startIndex,
      params: {},
    }),
  ]
}
```

**Pattern Types**:
- **Static views**: `key === "view:archive"`
- **Dynamic views**: `key.startsWith("view:tag:")` with extraction

---

### Step 4: Add Sidebar Navigation
**File**: `app/src/components/layout/Sidebar/utils/viewItems.ts`

Add your view to the sidebar items:

```typescript
export function buildViewItems(
  inboxCount: number,
  priorityQueueCount: number,
  projectsCount: number,
  routinesCount: number,
  yourViewCount: number  // Add parameter
): ViewItem[] {
  return [
    // ... existing items
    {
      viewKey: "view:your-view",
      label: "Your View",
      icon: YourIcon,
      count: yourViewCount,
    },
  ]
}
```

**Update Sidebar.tsx**:
```typescript
const yourViewCount = getCountForView("view:your-view", viewContext)
const viewItems = buildViewItems(
  inboxCount,
  priorityQueueCount,
  projectsCount,
  routinesCount,
  yourViewCount  // Pass count
)
```

---

### Step 5: Add URL Routing
**File**: `app/src/lib/routing/utils.ts`

Add URL mapping for your view:

```typescript
export function viewKeyToPath(viewKey: ViewKey, context?: ViewBuildContext): string {
  // ... existing mappings

  if (viewKey === "view:your-view") {
    return "/your-view"
  }

  // For dynamic views:
  if (viewKey.startsWith("view:tag:")) {
    const tagName = viewKey.replace("view:tag:", "")
    const slug = createSlug(tagName)
    return `/tags/${slug}`
  }
}

export function pathToViewKey(path: string, context?: ViewBuildContext): ViewKey | null {
  // ... existing mappings

  if (normalized === "/your-view") {
    return "view:your-view"
  }

  // For dynamic views:
  const tagMatch = normalized.match(/^\/tags\/(.+)$/)
  if (tagMatch) {
    const slug = tagMatch[1]
    // Look up tag by slug or use as-is
    return `view:tag:${slug}` as ViewKey
  }
}
```

---

### Step 6: Add Count Logic
**File**: `app/src/lib/views/CountRegistry.ts`

Add count calculation for your view:

```typescript
const countStrategies: Record<CountKey, CountStrategy> = {
  // ... existing strategies

  "list:your-view": {
    type: "query",
    queryBuilder: () => ({
      type: "your-query-type",
      timezoneOffsetMinutes: getTimezoneOffset(),
    }),
  },
}
```

**Strategy Types**:
- `"query"` - Fetch count via Convex query
- `"aggregate"` - Sum counts from multiple sources
- `"computed"` - Calculate from context data

---

### Step 7: Create ListView Component
**File**: `app/src/components/YourViewListView.tsx`

Create a component to render your view:

```typescript
import { TaskListView } from "./TaskListView"  // Or create custom

interface YourViewListViewProps {
  list: ListInstance
  onTaskCountChange: (listId: string, count: number) => void
  onTaskClick: (listId: string, taskIndex: number) => void
  focusedTaskIndex: number | null
  isDismissed: boolean
  onDismiss: (listId: string) => void
  onRestore: (listId: string) => void
  isMultiListView: boolean
}

export function YourViewListView(props: YourViewListViewProps) {
  // Option 1: Use existing TaskListView
  return <TaskListView {...props} />

  // Option 2: Create custom rendering
  return (
    <div>
      {/* Custom view implementation */}
    </div>
  )
}
```

**Rendering Options**:
- Reuse `TaskListView` for task-based views
- Reuse `ProjectsListView` for project-based views
- Create custom component for unique layouts

---

### Step 8: Update Layout Rendering
**File**: `app/src/components/layout/Layout.tsx`

Add rendering logic for your view:

```typescript
{activeView.lists.map((list) => {
  // ... existing renderers

  // Add your view renderer
  if (list.query.type === "your-query-type") {
    return (
      <YourViewListView
        key={list.id}
        list={list}
        onTaskCountChange={handleTaskCountChangeWithUpdate}
        onTaskClick={handleTaskClick}
        focusedTaskIndex={selection.listId === list.id ? selection.taskIndex : null}
        isDismissed={dismissedLists.has(list.id)}
        onDismiss={handleDismissList}
        onRestore={handleRestoreList}
        isMultiListView={isMultiListView}
      />
    )
  }
})}
```

---

### Step 9: Add Query Type (if needed)
**File**: `app/src/lib/views/types.ts`

If creating a new query type, add it to `ListQueryDefinition`:

```typescript
export type ListQueryDefinition =
  | { type: "inbox"; inboxProjectId?: string; timezoneOffsetMinutes?: number }
  | { type: "projects"; timezoneOffsetMinutes?: number }
  | { type: "routines"; timezoneOffsetMinutes?: number }
  | { type: "your-query-type"; timezoneOffsetMinutes?: number }  // ← Add here
```

---

### Step 10: Add Icon (optional)
**File**: `app/src/lib/icons/viewIcons.tsx`

Add icon mapping for your view:

```typescript
export function getViewIcon(viewKey: ViewKey, options?: IconOptions) {
  // ... existing icons

  if (viewKey === "view:your-view") {
    return <YourIcon className={className} />
  }
}
```

Import icon from `lucide-react` or create custom SVG.

---

## 🎯 Complete Example: Archive View

Here's a complete example of adding an "Archive" view:

### 1. types.ts
```typescript
export type ViewKey =
  | "view:archive"  // Added
  | ...
```

### 2. listDefinitions.tsx
```typescript
archive: {
  key: "archive",
  defaults: { collapsible: false, startExpanded: true },
  buildQuery: () => ({ type: "time", range: "archived" }),
  getHeader: () => ({ title: "Archive", icon: <Archive className="h-4 w-4" /> }),
  getEmptyState: () => ({ title: "No archived items" }),
}
```

### 3. viewRegistry.tsx
```typescript
{
  match: (key) => key === "view:archive",
  getDefinition: () => ({
    metadata: { title: "Archive", icon: getViewIcon("view:archive") },
    buildLists: (viewKey, index) => [
      instantiateList(listDefinitions.archive, {
        id: createListId(viewKey, "main"),
        viewKey,
        indexInView: index,
        params: {},
      }),
    ],
  }),
}
```

### 4. routing/utils.ts
```typescript
if (viewKey === "view:archive") return "/archive"
if (normalized === "/archive") return "view:archive"
```

### 5. Sidebar
```typescript
{
  viewKey: "view:archive",
  label: "Archive",
  icon: Archive,
  count: archiveCount,
}
```

### 6. Layout.tsx
```typescript
// Archive uses TaskListView, so no special rendering needed
// Falls through to default TaskListView rendering
```

---

## 📚 Reference Documentation

For detailed implementation examples, see:

- **Projects View**: `docs/projects-view-implementation.md`
  - Complete walkthrough of adding a custom view type
  - Custom query type and rendering

- **Routines System**: `docs/routines-system-implementation.md`
  - Complex view with custom data model
  - Full CRUD operations

- **URL Routing**: `docs/url-routing-implementation.md`
  - How routing works
  - Slug generation for clean URLs

---

## 🔧 Backend: Adding Convex Queries (if needed)

If your view needs a custom Convex query:

### 1. Create Query
**File**: `convex/todoist/queries/getYourData.ts`

```typescript
import { query } from "../_generated/server"

export const getYourData = query({
  handler: async (ctx) => {
    // Query logic
    return items
  },
})
```

### 2. Export Query
**File**: `convex/todoist/publicQueries.ts`

```typescript
export { getYourData } from "./queries/getYourData"
```

### 3. Use in Component
```typescript
const data = useQuery(api.todoist.publicQueries.getYourData)
```

---

## ✅ Validation Checklist

Before considering the view complete:

- [ ] View appears in sidebar
- [ ] Count badge shows correct number
- [ ] URL updates when navigating to view
- [ ] Direct URL navigation works
- [ ] Browser back/forward works
- [ ] Empty state displays when no items
- [ ] Items render correctly
- [ ] Keyboard shortcuts work (if applicable)
- [ ] TypeScript compiles: `bun run build`
- [ ] No console errors
- [ ] Matches design patterns of existing views

---

## 🚀 Common Patterns

### Task-Based Views
Use `TaskListView` component and `type: "time"` or `type: "priority"` queries.

**Examples**: Inbox, Today, Upcoming, Overdue

### Project-Based Views
Use `ProjectsListView` component and `type: "projects"` queries.

**Examples**: Projects

### Custom Views
Create new ListView component and custom query type.

**Examples**: Routines

### Dynamic Views
Use parameterized ViewKeys with extraction logic.

**Examples**: `view:project:${id}`, `view:label:${name}`

---

## 🎨 Design Principles

1. **Follow existing patterns** - Look at similar views for guidance
2. **Reuse components** - Use TaskListView/ProjectsListView when possible
3. **Keep it simple** - Don't over-engineer
4. **Test thoroughly** - Validate all user interactions
5. **Document changes** - Update this guide if you discover new patterns

---

## 🆘 Troubleshooting

### View doesn't appear in sidebar
- Check viewItems.ts includes your view
- Verify count is being calculated
- Check Sidebar.tsx passes count to buildViewItems()

### URL routing doesn't work
- Verify viewKeyToPath() and pathToViewKey() both added
- Check for typos in path matching
- Test browser back/forward navigation

### Count shows 0 or wrong number
- Check CountRegistry.ts strategy is correct
- Verify query returns expected data
- Test count calculation logic

### TypeScript errors
- Ensure ViewKey type includes your view
- Check ListQueryDefinition includes query type
- Verify all type imports are correct

---

**Questions?** Review the complete implementation docs in `docs/` folder or search existing view implementations for examples.
