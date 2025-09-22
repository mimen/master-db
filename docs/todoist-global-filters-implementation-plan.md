# Todoist Global Filters Implementation Plan

## Overview
This document outlines the implementation plan for a clean, scalable global filter system for Todoist queries in Convex. The system provides both automatic filtering (excluded labels, star prefix) and user-configurable filtering (assignees) with UI override capability.

## Core Design Principles
1. **Single Source of Truth**: All filtering logic in one place
2. **Opt-in Raw Access**: Internal queries bypass filters for sync operations
3. **UI Override Priority**: UI → User Settings → System Default
4. **Type Safety**: Full TypeScript support throughout
5. **Performance**: Efficient filtering at query time

## Implementation Phases

### Phase 1: Core Filter Infrastructure

#### 1.1 Create Global Filters Module
**File**: `convex/todoist/helpers/globalFilters.ts`

```typescript
// Constants for system-wide exclusions
export const SYSTEM_EXCLUDED_LABELS = [
  'area-of-responsibility',
  'project-type', 
  'project-metadata'
] as const;

// Filter configuration types
export interface GlobalFilterConfig {
  assigneeFilter?: AssigneeFilterType;
  currentUserId?: string;
  includeCompleted?: boolean; // Default: false
  includeStarPrefix?: boolean; // Default: false
}

export type AssigneeFilterType = 
  | 'all'
  | 'unassigned'
  | 'assigned-to-me'
  | 'assigned-to-others'
  | 'not-assigned-to-others'; // Default

// Main filter function
export function applyGlobalFilters(
  items: TodoistItem[],
  config: GlobalFilterConfig = {}
): TodoistItem[] {
  const {
    assigneeFilter = 'not-assigned-to-others',
    currentUserId,
    includeCompleted = false,
    includeStarPrefix = false,
  } = config;

  return items.filter(item => {
    // 1. Star prefix filter (e.g., "* Project metadata")
    if (!includeStarPrefix && item.content.startsWith('* ')) {
      return false;
    }
    
    // 2. Completed items filter
    if (!includeCompleted && item.checked === 1) {
      return false;
    }
    
    // 3. System excluded labels filter
    if (item.labels.some(label => SYSTEM_EXCLUDED_LABELS.includes(label))) {
      return false;
    }
    
    // 4. Assignee filter
    if (assigneeFilter !== 'all') {
      switch (assigneeFilter) {
        case 'unassigned':
          return !item.responsible_uid;
          
        case 'assigned-to-me':
          return item.responsible_uid === currentUserId;
          
        case 'assigned-to-others':
          return item.responsible_uid && item.responsible_uid !== currentUserId;
          
        case 'not-assigned-to-others':
          return !item.responsible_uid || item.responsible_uid === currentUserId;
      }
    }
    
    return true;
  });
}
```

### Phase 2: Query Architecture

#### 2.1 Internal (Raw) Queries
**Location**: `convex/todoist/internal/queries/`

```typescript
// convex/todoist/internal/queries/getRawActiveItems.ts
export const getRawActiveItems = internalQuery({
  args: {
    projectId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("todoist_items")
      .filter((q) => q.eq(q.field("checked"), 0));

    if (args.projectId) {
      q = q.filter((q) => q.eq(q.field("project_id"), args.projectId));
    }

    const items = await q.collect();
    const sortedItems = items.sort((a, b) => a.child_order - b.child_order);
    
    if (args.limit && args.limit > 0) {
      return sortedItems.slice(0, args.limit);
    }
    
    return sortedItems;
  },
});
```

#### 2.2 Public (Filtered) Queries
**Update**: `convex/todoist/queries/getActiveItems.ts`

```typescript
import { applyGlobalFilters } from "../helpers/globalFilters";
import { internal } from "../../_generated/api";

export const getActiveItems = query({
  args: {
    projectId: v.optional(v.string()),
    limit: v.optional(v.number()),
    // UI can override assignee filter
    assigneeFilter: v.optional(
      v.union(
        v.literal('all'),
        v.literal('unassigned'),
        v.literal('assigned-to-me'),
        v.literal('assigned-to-others'),
        v.literal('not-assigned-to-others')
      )
    ),
  },
  handler: async (ctx, args) => {
    // Get raw data from internal query
    const rawItems = await ctx.runQuery(
      internal.todoist.internal.queries.getRawActiveItems,
      { projectId: args.projectId, limit: args.limit }
    );
    
    // Get user settings if no assignee filter provided
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;
    
    let effectiveAssigneeFilter = args.assigneeFilter;
    if (!effectiveAssigneeFilter && userId) {
      const userSettings = await ctx.db
        .query("user_settings")
        .withIndex("by_user_id", q => q.eq("user_id", userId))
        .first();
      
      effectiveAssigneeFilter = userSettings?.defaultAssigneeFilter;
    }
    
    // Apply global filters
    return applyGlobalFilters(rawItems, {
      assigneeFilter: effectiveAssigneeFilter,
      currentUserId: userId,
    });
  },
});
```

### Phase 3: User Settings

#### 3.1 Schema Addition
**File**: `convex/schema/userSettings.ts`

```typescript
export const userSettingsSchema = defineTable({
  user_id: v.string(),
  default_assignee_filter: v.optional(
    v.union(
      v.literal('all'),
      v.literal('unassigned'), 
      v.literal('assigned-to-me'),
      v.literal('assigned-to-others'),
      v.literal('not-assigned-to-others')
    )
  ),
  created_at: v.number(),
  updated_at: v.number(),
})
  .index("by_user_id", ["user_id"]);
```

#### 3.2 Settings Mutations
**File**: `convex/todoist/mutations/updateUserSettings.ts`

```typescript
export const updateDefaultAssigneeFilter = mutation({
  args: {
    assigneeFilter: v.union(
      v.literal('all'),
      v.literal('unassigned'),
      v.literal('assigned-to-me'),
      v.literal('assigned-to-others'),
      v.literal('not-assigned-to-others')
    ),
  },
  handler: async (ctx, { assigneeFilter }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    
    const userId = identity.subject;
    const existing = await ctx.db
      .query("user_settings")
      .withIndex("by_user_id", q => q.eq("user_id", userId))
      .first();
    
    if (existing) {
      await ctx.db.patch(existing._id, {
        default_assignee_filter: assigneeFilter,
        updated_at: Date.now(),
      });
    } else {
      await ctx.db.insert("user_settings", {
        user_id: userId,
        default_assignee_filter: assigneeFilter,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    }
  },
});
```

### Phase 4: Advanced Filtering

#### 4.1 Filter Builder Pattern
```typescript
// convex/todoist/helpers/filterBuilder.ts
export class TodoistFilterBuilder {
  private filters: ((item: TodoistItem) => boolean)[] = [];
  
  excludeLabels(labels: string[]): this {
    this.filters.push(item => 
      !item.labels.some(label => labels.includes(label))
    );
    return this;
  }
  
  excludeStarPrefix(): this {
    this.filters.push(item => !item.content.startsWith('* '));
    return this;
  }
  
  excludeCompleted(): this {
    this.filters.push(item => item.checked === 0);
    return this;
  }
  
  filterByAssignee(type: AssigneeFilterType, userId?: string): this {
    // Implementation based on type
    return this;
  }
  
  build(): (item: TodoistItem) => boolean {
    return (item) => this.filters.every(filter => filter(item));
  }
}
```

## Query Update Strategy

### Queries to Update
1. `getActiveItems` ✓
2. `getItemsByProject`
3. `getItemsByLabel` 
4. `getItemsByPriority`
5. `getOverdueItems`
6. `getTodayItems`
7. `getUpcomingItems`

### Update Pattern
For each query:
1. Create internal raw version in `internal/queries/`
2. Update public version to use internal + global filters
3. Add optional `assigneeFilter` argument
4. Test with various filter combinations

## Usage Examples

### Frontend Usage
```typescript
// Use default filter (user setting or system default)
const tasks = useQuery(api.todoist.queries.getActiveItems);

// Override with specific filter
const unassignedTasks = useQuery(api.todoist.queries.getActiveItems, {
  assigneeFilter: 'unassigned'
});

// Update user preference
const updateFilter = useMutation(api.todoist.mutations.updateDefaultAssigneeFilter);
await updateFilter({ assigneeFilter: 'assigned-to-me' });
```

### Sync Operations (Bypass Filters)
```typescript
// Sync uses internal queries to access all data
const allItems = await ctx.runQuery(
  internal.todoist.internal.queries.getRawActiveItems
);
```

## Testing Strategy

### Unit Tests for Filters
```typescript
// convex/todoist/helpers/globalFilters.test.ts
describe('applyGlobalFilters', () => {
  it('excludes star prefix tasks by default', () => {
    const items = [
      { content: '* Project metadata', ... },
      { content: 'Regular task', ... },
    ];
    const filtered = applyGlobalFilters(items);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].content).toBe('Regular task');
  });

  it('excludes system labels', () => {
    const items = [
      { labels: ['area-of-responsibility'], ... },
      { labels: ['normal-label'], ... },
    ];
    const filtered = applyGlobalFilters(items);
    expect(filtered).toHaveLength(1);
  });

  it('respects assignee filter overrides', () => {
    const items = [
      { responsible_uid: 'user1', ... },
      { responsible_uid: null, ... },
    ];
    const filtered = applyGlobalFilters(items, {
      assigneeFilter: 'unassigned',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].responsible_uid).toBeNull();
  });
});
```

## Benefits

1. **Clean Separation**: Raw data access for sync, filtered for UI
2. **Flexible Override**: UI → User Settings → System Default priority chain
3. **Performance**: Single filter pass at query time
4. **Maintainable**: All filter logic in one module
5. **Type Safe**: Full TypeScript coverage
6. **Extensible**: Easy to add new filter types

## Migration Path

1. Deploy Phase 1 (core infrastructure)
2. Update one query at a time starting with `getActiveItems`
3. Add user settings support
4. Migrate remaining queries
5. Update frontend to use new filter arguments

## Future Enhancements

- Custom filter predicates (as outlined in convex-filter-system-proposal-v2.md)
- Filter performance metrics
- Filter caching for complex predicates
- Bulk filter operations