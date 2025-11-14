# Unified Icon System

This directory contains the **single source of truth** for all view icons across the application.

## Overview

Previously, icons were defined in multiple places:
- `viewRegistry.tsx` (for top bar)
- `listDefinitions.tsx` (for list headers)
- `filterItems.ts` (for sidebar filters)
- `viewItems.ts` (for sidebar views)
- `multi-list/defaults.tsx` (for multi-lists)
- `NavHeader.tsx` (for command palette)

This led to duplication, inconsistency, and maintenance burden.

## New Architecture

All view icons are now centralized in `viewIcons.tsx`:

```typescript
import { getViewIcon } from "@/lib/icons/viewIcons"

// Get icon for any view (colors applied automatically)
const icon = getViewIcon("view:inbox", { size: "sm" })
const icon = getViewIcon("view:priority:p1", { size: "lg" })
const icon = getViewIcon("view:label:work", { size: "sm", color: "blue" })
```

## Functions

### `getViewIcon(viewKey, options)`

Returns the appropriate icon for any `ViewKey`.

**Parameters:**
- `viewKey: ViewKey` - The view identifier (e.g., `"view:inbox"`, `"view:priority:p1"`)
- `options?: IconOptions`
  - `size?: "sm" | "md" | "lg"` - Icon size (sm=4x4, md=5x5, lg=6x6)
  - `className?: string` - Additional CSS classes
  - `color?: string` - Optional color override (for labels)

**Note:** Icons automatically include semantic colors where appropriate:
- Time filters (today, upcoming, overdue, no-date) are colored
- Priority icons (P1-P4) use priority colors
- Labels use their Todoist color if provided

**Supported Views:**
- Top-level: `inbox`, `today`, `upcoming`, `priority-queue`, `settings`
- Time filters: `time:overdue`, `time:today`, `time:upcoming`, `time:no-date`
- Priorities: `priority:p1` through `priority:p4`
- Priority Projects: `priority-projects:p1` through `priority-projects:p4`
- Labels: `label:{name}`
- Projects: Use `getProjectIcon()` instead
- Multi-lists: `multi:priority-queue`, `multi:morning-review`, `multi:weekly-planning`

### `getProjectIcon(color, options)`

Returns a colored dot icon for projects.

**Parameters:**
- `color: string` - Todoist color name (e.g., `"charcoal"`, `"blue"`)
- `options?: IconOptions`
  - `size?: "sm" | "md" | "lg"` - Dot size
  - `className?: string` - Additional CSS classes

### `getLabelIcon(color, options)`

Returns a colored tag icon for labels.

**Parameters:**
- `color: string` - Todoist color name
- `options?: IconOptions` - Same as above

## Usage Examples

### In View Registry

```typescript
// viewRegistry.tsx
import { getViewIcon, getProjectIcon } from "@/lib/icons/viewIcons"

{
  metadata: {
    title: "Inbox",
    icon: getViewIcon("view:inbox", { size: "sm" })
  }
}
```

### In List Definitions

```typescript
// listDefinitions.tsx
import { getViewIcon } from "@/lib/icons/viewIcons"

getHeader: () => ({
  icon: getViewIcon("view:time:today", { size: "lg" })
})
```

### In Multi-List Configs

```typescript
// multi-list/defaults.tsx
import { getViewIcon } from "@/lib/icons/viewIcons"

{
  id: "priority-queue",
  icon: getViewIcon("view:multi:priority-queue", { size: "sm" })
}
```

## Icon Sizes

Icons are available in three sizes:

| Size | Class | Use Case |
|------|-------|----------|
| `sm` | `h-4 w-4` | Top bar, sidebar, badges |
| `md` | `h-5 w-5` | Medium UI elements |
| `lg` | `h-6 w-6` | List headers, prominent sections |

## Icon Colors

Icons automatically include semantic colors where appropriate:

### Time-Based Views
- **Overdue**: Red (`text-red-500`)
- **Today**: Blue (`text-blue-500`)
- **Upcoming**: Green (`text-green-500`)
- **No Date**: Gray (`text-gray-500`)

### Priority Views
- **P1**: Red (highest priority)
- **P2**: Orange (high priority)
- **P3**: Blue (medium priority)
- **P4**: No color (normal priority)

### Labels
- Use the label's Todoist color when `color` option is provided
- Default to standard icon color if no color specified

### Projects
- Always use the project's color as a colored dot icon

## Benefits

1. **Single Source of Truth**: One place to update all icons
2. **Type Safety**: ViewKey-based lookup catches errors at compile time
3. **Consistency**: Impossible to have different icons for same view
4. **Maintainability**: Add new views by updating one file
5. **Reusability**: Same icon function works everywhere
6. **Size Flexibility**: Easy to render same icon at different sizes

## Migration Notes

When adding a new view type:

1. Add the ViewKey pattern to `types.ts` if needed
2. Add icon mapping in `getViewIcon()` function
3. Use `getViewIcon()` in all consumers:
   - viewRegistry.tsx
   - listDefinitions.tsx (if applicable)
   - multi-list configs (if applicable)

That's it! No need to update multiple files.
