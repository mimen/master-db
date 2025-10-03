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
- [ ] Add more items as needed

