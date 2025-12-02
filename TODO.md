# TODO

## Performance Optimizations

### Label Filtering - Junction Table Denormalization
**Status**: Deferred  
**Priority**: Low-Medium

**Problem**: 
Label filtering currently requires loading all active items from DB, then filtering by label in-memory. This is better than before (when we loaded ALL items and filtered everything), but not ideal for large datasets.

**Current Implementation**:
- Uses `active_items` index to get active items
- Filters `item.labels.includes(labelName)` in JavaScript
- ~50% fewer items loaded vs old approach, but still O(n) for label check

**Proposed Solution**:
Create a junction table `todoist_item_labels` with schema:
```typescript
{
  item_id: v.string(),
  label_name: v.string(),
  is_deleted: v.boolean(),
  checked: v.boolean(),
}
```

With index: `["label_name", "is_deleted", "checked"]`

**Benefits**:
- Fully server-side label filtering using DB index
- O(log n) lookup instead of O(n) scan
- Can combine with other filters efficiently

**Tradeoffs**:
- Additional table to maintain
- Sync complexity: must denormalize labels on every item update
- More storage (denormalized data)
- Mutation overhead: update both `todoist_items` AND junction table

**Recommendation**: 
Monitor label query performance. Implement only if:
- Label queries become a bottleneck
- Dataset grows to >10k active items
- User reports slow label filtering

**Effort**: ~4 hours (schema, sync logic, migration, tests)

---

## Future Enhancements

### URL-Based View State Persistence
**Status**: Planned
**Priority**: Medium
**Dependencies**: Phase 1 view refactor (✅ completed)

**Goal**:
Preserve view state in URL for shareable views and browser navigation support.

**Implementation Approach**:
- Add React Router or Tanstack Router (evaluate both)
- URL structure: `/inbox`, `/project/123`, `/multi/priority/p1`
- Serialize `ViewConfig[]` to URL params for multi-views
- Support browser back/forward navigation
- Enable deep linking and view sharing

**Considerations**:
- **Router choice**: Evaluate React Router vs Tanstack Router vs Wouter
  - React Router: Industry standard, larger bundle (~10KB)
  - Tanstack Router: Type-safe, modern, better DevEx
  - Wouter: Minimal (~1.5KB), simple
- **Serialization**: Complex multi-views need robust URL encoding/decoding
- **Backward compatibility**: Handle direct URL access gracefully
- **State sync**: Keep URL in sync with view state changes
- **Migration**: No breaking changes for existing users

**Technical Design**:
```typescript
// Example URL patterns
/inbox                    → Single inbox view
/project/123              → Single project view
/multi/priority-queue     → Priority queue multi-view (serialized)
/multi/priority/p1        → P1 projects multi-view
/project/123/children     → Project with children expanded

// ViewConfig[] serialization
function serializeViews(views: ViewConfig[]): string
function deserializeViews(url: string): ViewConfig[]
```

**Estimated Effort**: 6-8 hours

**Benefits**:
- ✅ Shareable task views via URL
- ✅ Browser back/forward support
- ✅ Bookmark specific views
- ✅ Deep linking from external tools
- ✅ Better UX for multi-tab workflows

---

### List Item Standardization - Phase 4: BaseListView Component
**Status**: ✅ Complete
**Priority**: N/A (Completed)
**Completed**: 2025-11-17
**Dependencies**: Phase 1-3 (✅ completed)

**Goal**:
Create a reusable `BaseListView` component that consolidates common list view patterns (header rendering, empty state, collapse/expand, focus management, count tracking) across Tasks, Projects, and Routines.

**Final State**:
- Phase 1 (Extract hooks) ✅ Complete
- Phase 2 (Standardize badges) ✅ Complete
- Phase 3 (BaseListItem component) ✅ Complete
- Phase 4 (BaseListView component) ✅ Complete (2025-11-17)

**Results Achieved**:
- ✅ BaseListView component created (515 lines, fully generic with TypeScript)
- ✅ TaskListView refactored: 287 → 121 lines (58% reduction)
- ✅ ProjectsListView refactored: 267 → 138 lines (48% reduction)
- ✅ RoutinesListView refactored: 245 → 152 lines (38% reduction)
- ✅ Total code reduction: 799 → 411 lines (49% reduction)
- ✅ All 8 duplicate patterns abstracted successfully
- ✅ Sort & Group feature built on top of BaseListView
- ✅ Zero regressions, all features working

**Architecture Benefits Realized**:
- Clean separation: BaseListView (layout), Parent (data), ListItem (rendering)
- Easy to add new entity types (just configure BaseListView)
- Consistent behavior across all list views
- Proven robust with multiple features built on top

**References**:
- Planning doc: `docs/list-item-standardization-plan.md`
- Phase 4 implementation: `docs/list-item-standardization-phase4-implementation.md`
- API design doc: `docs/list-item-standardization-phase4-api-design.md`

---

- [ ] Add more items as needed

