# View & List Manifest Implementation Plan

## Goal
Introduce a manifest-driven architecture that standardises how the app defines, renders, and fetches task lists. The manifest separates reusable list templates from user-facing views, eliminating scattered metadata, reducing redundant data fetching, and making it easy to compose new multi-list experiences or plug in non-Todoist sources.

## Terminology
- **List**: A single task list panel rendered in the UI. It combines a data query with presentation metadata (title, icon, empty-state copy, limits, collapse state).
- **List Definition**: A template describing how to produce a List. It includes the canonical key (e.g. `inbox`, `project:{id}`), the Convex resolver to fetch data, default UI metadata, and dependency hints.
- **View**: The user-facing selection that activates one or more Lists. Examples: Inbox (single List), Priority Queue (multiple Lists).
- **View Definition**: A manifest entry that maps a View key to one or more List Definitions plus per-instance overrides (custom title, icon, max tasks, etc.) and bundle-level metadata (name, description, icon).
- **View Resolver**: Runtime utility that expands a View Definition into fully-fledged List instances, ready for rendering and querying.

## Manifest Architecture

### List Definitions
Each definition should capture:
- **Key**: String identifier (supports templates such as `project:{id}` or `label:{name}`).
- **Resolver**: Function that turns template params into Convex query args. Keeps backend queries aligned with the manifest.
- **Default Metadata**: Title, description, icon token/component, empty-state copy, default collapse behaviour.
- **Limits & Overrides**: Optional defaults like `maxTasks`.
- **Dependencies**: Flags indicating supporting data requirements (project palette, label colour map, counts, etc.) so the renderer knows which supplemental queries to issue.
- **Item Adapter**: (Optional) mapping to transform provider-specific payloads into the UI’s list item interface if different sources get introduced later.

Store these in `app/src/lib/views/listDefinitions.ts` (or similar) and export typed helpers for both frontend and Convex packages.

### View Definitions
For each View:
- **Key & Category**: e.g. `view:inbox`, `view:priority-queue`, `view:project:{id}`.
- **Bundle Metadata**: Display name, icon, description used in navigation.
- **List Sequence**: Ordered array of `{ listKey, params, overrides }` objects referencing List Definitions.
- **Behaviour Flags**: e.g. whether to auto-focus first task, pin collapsed state, or show bundle-level controls.

Composite views simply provide multiple entries in the sequence. Multi-lists become first-class View Definitions referencing the same List Definitions.

### Expansion Flow
1. **Selection**: User picks a View key (sidebar, shortcut, multi-list).
2. **Lookup**: View Resolver fetches the View Definition from the manifest.
3. **Expansion**: For each List reference, resolve template params, apply overrides, and pull default metadata.
4. **Dependency Aggregation**: Merge dependency flags across Lists so the renderer only fetches necessary supplemental data (e.g., project palettes once).
5. **Render**: Pass the resulting List instances to layout; each List contains query args + UI metadata.
6. **Query Execution**: Data hooks use the resolver-provided query args to call Convex `getItemsByList` (renamed from `getItemsByView`) or provider-specific actions.

## Renderer & UI Integration
- Update `Sidebar`, quick switchers, and other navigation to source their labels/icons directly from View Definitions.
- Refactor `TaskListView` to accept a `ListInstance` object. Remove hard-coded switch statements; use metadata from the manifest and dependency hints to fetch project/label details on demand.
- Handle per-list overrides uniformly (custom icon/title, limits). For multi-lists, the overrides already exist—move them into View Definitions with explicit intent.

## Backend Alignment
- Consolidate Convex query branching into a `getItemsByList` function that keys off manifest identifiers. Share the list key enum between frontend and backend (generated or manual) to prevent drift.
- For parameterised lists, ensure the resolver outputs a normalized payload (e.g., `type: "project", id: "123"`). Convex can then pattern-match by `type` rather than string parsing.
- Optional: expose manifest helpers (or at least the key enum) from `convex/` to keep types in sync.

## Extensibility Beyond Todoist
- New data sources register additional List Definitions with their own query resolvers and metadata.
- Views can mix providers because they only compose List Definitions. The renderer checks provider tags to choose the correct row component or action handlers.
- Item adapters can map provider-specific fields into a shared presentation interface.

## Implementation Phases
1. **Scaffold Types & Manifest**
   - Define TypeScript types for `ListDefinition`, `ViewDefinition`, `ListInstance`.
   - Create initial manifest covering existing Todoist lists and views.
   - Export shared enums/types for Convex.

2. **Introduce View Resolver**
   - Implement runtime expansion logic with dependency aggregation.
   - Add unit tests covering simple and composite views.

3. **Refactor UI Consumers**
   - Update `Sidebar`, `TaskListView`, multi-list flows to use the resolver output.
   - Remove duplicated metadata (titles, icons, empty states) from components.

4. **Align Convex Queries**
   - Rename `getItemsByView` to work with manifest keys and structured params.
   - Replace string parsing with typed request objects.

5. **Clean Up & Document**
   - Delete legacy helper maps (priority map, label strings) replaced by manifest data.
   - Document contribution guidelines for adding new lists/views.

6. **Future Enhancements**
   - Add support for provider-specific renderers if/when non-Todoist sources ship.
   - Consider codegen to keep manifest-derived enums in sync across packages.

## Risks & Open Questions
- **Parameter Handling**: Need a clear strategy for runtime parameters (project IDs, label names) so they flow through the resolver without string concatenation.
- **Data Dependencies**: Ensure dependency flags cover all supplemental data (project stats, label colours, counts) to prevent over-fetching.
- **Caching & Performance**: Composite views could spawn many Convex calls; evaluate batching or bulk endpoints as needed.
- **Testing**: Plan snapshot/unit coverage for manifest expansion to prevent regressions when adding new views.
- **Provider Divergence**: Decide how much the shared item interface can vary before we need provider-specific list components.

## Next Steps
- Review this plan with the team for terminology alignment.
- Finalise the manifest file layout and naming conventions.
- Begin Phase 1 by codifying the current Todoist views into `ListDefinition` and `ViewDefinition` structures.
