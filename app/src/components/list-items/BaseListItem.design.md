# BaseListItem Component - API Design

## Overview

`BaseListItem` is a generic, reusable component that encapsulates common list item patterns (hover, editing, focus management, styling) across Tasks, Projects, and Routines. It uses TypeScript generics to support any entity type while allowing entity-specific customization through render props.

## Component API

```typescript
interface BaseListItemProps<T> {
  /**
   * Entity instance
   */
  entity: T

  /**
   * Entity type identifier ("task" | "project" | "routine" | string)
   * Used for data attributes and keyboard shortcuts
   */
  entityType: string

  /**
   * Function to extract unique ID from entity
   * @example getEntityId={(task) => task.todoist_id}
   */
  getEntityId: (entity: T) => string

  // ============= RENDER PROPS (required/optional) =============

  /**
   * Render left element (checkbox, color dot, icon, etc)
   * @param isHovered True if row is currently hovered
   */
  renderLeftElement?: (isHovered: boolean) => React.ReactNode

  /**
   * Render primary content (name/title)
   * Called only in display mode, not when editing
   */
  renderPrimaryDisplay: (entity: T) => React.ReactNode

  /**
   * Render secondary content (description) or null to hide
   * Called only in display mode, not when editing
   */
  renderSecondaryDisplay?: (entity: T) => React.ReactNode | null

  /**
   * Render fixed badges (always shown, not hover-dependent)
   * @param entity Current entity
   * @param isHovered True if row is hovered
   */
  renderFixedBadges?: (entity: T, isHovered: boolean) => React.ReactNode

  /**
   * Render hover-only badges (shown only on hover)
   * @param entity Current entity
   */
  renderHoverBadges?: (entity: T) => React.ReactNode

  // ============= EDITING CONFIGURATION =============

  /**
   * Primary field configuration (name/content)
   */
  primaryField?: {
    value: string
    placeholder?: string
    /**
     * Key used in onSave changes object
     * @default "name"
     */
    key?: string
  }

  /**
   * Secondary field configuration (description)
   * If not provided, secondary editing is disabled
   */
  secondaryField?: {
    value: string | undefined
    placeholder?: string
    /**
     * Key used in onSave changes object
     * @default "description"
     */
    key?: string
  }

  /**
   * Called when user saves edited content
   * @param changes Object with edited fields: { name?, description? }
   */
  onSave?: (changes: Record<string, string | undefined>) => Promise<void>

  // ============= INTERACTION HANDLERS =============

  /**
   * Called when row is clicked
   * Render props (badge clicks) call stopPropagation before this
   */
  onClick?: () => void

  /**
   * Ref callback for parent's focus management
   * Parent uses this to build ref array for keyboard shortcuts
   */
  onElementRef?: (element: HTMLDivElement | null) => void

  // ============= STYLING & CLASS OPTIONS =============

  /**
   * Primary content display mode
   * @default "wrap"
   */
  contentDisplayMode?: 'wrap' | 'truncate'

  /**
   * Class applied when item is archived/deferred
   * @example "opacity-60"
   */
  archivedClass?: string

  /**
   * Additional wrapper classes
   */
  className?: string
}
```

## Component Structure

```tsx
<div
  ref={ref}
  data-entity-type={entityType}
  data-entity-id={getEntityId(entity)}
  className={classNames}
  onMouseEnter={onMouseEnter}
  onMouseLeave={onMouseLeave}
  onClick={onClick}
>
  {/* Left element slot */}
  {renderLeftElement && (
    <div className="flex-shrink-0">
      {renderLeftElement(isHovered)}
    </div>
  )}

  {/* Content area */}
  <div className="flex-1 min-w-0 space-y-1.5">
    {/* Primary field (editable or display) */}
    {isEditing ? (
      <input value={primaryValue} onChange={...} onKeyDown={...} />
    ) : (
      <div className={contentDisplayMode}>
        {renderPrimaryDisplay(entity)}
      </div>
    )}

    {/* Secondary field (if provided) */}
    {secondaryField && (
      isEditing ? (
        <input value={secondaryValue} onChange={...} onKeyDown={...} />
      ) : (
        renderSecondaryDisplay && renderSecondaryDisplay(entity)
      )
    )}

    {/* Badges container */}
    <div className="flex flex-wrap items-center gap-1">
      {renderFixedBadges?.(entity, isHovered)}
      {isHovered && renderHoverBadges?.(entity)}
    </div>
  </div>
</div>
```

## Key Features

### 1. Internal Editing Management
- Component uses `useListItemEditing()` hook internally
- No need for parent to manage editing state
- Keyboard shortcuts (Enter, Escape, Tab, Shift+Enter) all handled
- Optimistic updates handled by parent's render prop

### 2. Hover State
- Uses `useListItemHover()` internally
- Passed to both render functions and badges
- Enables conditional ghost badge rendering

### 3. Focus Management
- Ref forwarding for parent's focus array
- Exposes editing methods on element for keyboard shortcuts
- Works with existing focus management hooks

### 4. Data Attributes
- `data-entity-type`: "task" | "project" | "routine"
- `data-entity-id`: Unique ID for focus/keyboard shortcuts
- Used by parent to locate element for focus operations

## Usage Examples

### TaskListItem

```tsx
<BaseListItem<Task>
  entity={task}
  entityType="task"
  getEntityId={(t) => t.todoist_id}

  renderLeftElement={(isHovered) => (
    <CheckboxButton
      checked={task.checked}
      isHovered={isHovered}
      onComplete={handleComplete}
    />
  )}

  primaryField={{
    value: displayContent,
    key: 'content'
  }}

  secondaryField={{
    value: displayDescription,
    key: 'description'
  }}

  renderPrimaryDisplay={(task) => (
    <ParsedContent content={task.content} />
  )}

  renderSecondaryDisplay={(task) =>
    task.description ? (
      <div className="text-xs text-muted-foreground">
        {task.description}
      </div>
    ) : null
  }

  renderFixedBadges={(task, isHovered) => (
    <TaskBadges task={task} isHovered={isHovered} />
  )}

  renderHoverBadges={(task) => (
    <TaskHoverBadges task={task} />
  )}

  onSave={async (changes) => {
    if (changes.content) {
      await updateTaskContent(task.todoist_id, changes.content)
    }
    if (changes.description !== undefined) {
      await updateTaskDescription(task.todoist_id, changes.description)
    }
  }}

  onClick={() => onTaskClick(task)}
  onElementRef={taskRefHandlers[index]}

  contentDisplayMode="wrap"
  archivedClass={task.checked ? "opacity-50" : ""}
/>
```

### ProjectListItem

```tsx
<BaseListItem<TodoistProjectWithMetadata>
  entity={project}
  entityType="project"
  getEntityId={(p) => p.todoist_id}

  renderLeftElement={() => (
    <div
      className="w-4 h-4 rounded-full shrink-0"
      style={{ backgroundColor: getProjectColor(project.color) }}
    />
  )}

  primaryField={{
    value: displayName,
    key: 'name'
  }}

  secondaryField={{
    value: displayDescription,
    key: 'description'
  }}

  renderPrimaryDisplay={(project) => (
    <div className="font-medium">{project.name}</div>
  )}

  renderSecondaryDisplay={(project) =>
    project.metadata?.description ? (
      <p className="text-xs text-muted-foreground">
        {project.metadata.description}
      </p>
    ) : null
  }

  renderFixedBadges={(project) => (
    <ProjectBadges project={project} />
  )}

  renderHoverBadges={(project) => (
    <ProjectHoverBadges project={project} />
  )}

  onSave={async (changes) => {
    if (changes.name) {
      await updateProjectName(project.todoist_id, changes.name)
    }
    if (changes.description !== undefined) {
      await updateProjectDescription(project.todoist_id, changes.description)
    }
  }}

  onClick={() => onProjectClick(project)}
  onElementRef={projectRefHandlers[index]}

  archivedClass={project.is_archived ? "opacity-60" : ""}
/>
```

### RoutineListItem

```tsx
<BaseListItem<Doc<"routines">>
  entity={routine}
  entityType="routine"
  getEntityId={(r) => r._id}

  renderLeftElement={() => (
    <Repeat className="h-4 w-4 text-purple-600" />
  )}

  primaryField={{
    value: effectiveName,
    key: 'name'
  }}

  secondaryField={{
    value: effectiveDescription,
    key: 'description'
  }}

  renderPrimaryDisplay={(routine) => (
    <div className="font-medium">{routine.name}</div>
  )}

  renderSecondaryDisplay={(routine) =>
    routine.description ? (
      <div className="text-sm text-muted-foreground truncate">
        {routine.description}
      </div>
    ) : null
  }

  renderFixedBadges={(routine) => (
    <RoutineBadges routine={routine} />
  )}

  renderHoverBadges={(routine) => (
    <RoutineHoverBadges routine={routine} />
  )}

  onSave={async (changes) => {
    if (changes.name) {
      await updateRoutineName(routine._id, changes.name)
    }
    if (changes.description !== undefined) {
      await updateRoutineDescription(routine._id, changes.description)
    }
  }}

  onClick={() => onRoutineClick(routine)}
  onElementRef={routineRefHandlers[index]}

  contentDisplayMode="truncate"
  archivedClass={routine.defer ? "opacity-60" : ""}
/>
```

## TypeScript Generics

The component is fully generic and preserves entity type through the entire component:

```typescript
const taskItem = <BaseListItem<Task> ... />
const projectItem = <BaseListItem<TodoistProjectWithMetadata> ... />
const routineItem = <BaseListItem<Doc<"routines">> ... />

// TypeScript knows the exact entity type for all render props
// Auto-completion works for properties like task.todoist_id, etc.
```

## Implementation Details

### Internal Hooks
- `useListItemHover()`: Track hover state
- `useListItemEditing()`: Manage editing state, keyboard handlers
- `forwardRef`: Support parent's focus management

### Styling Classes
```typescript
// Wrapper
"group cursor-pointer transition-all duration-150 rounded-md border border-transparent p-2.5 hover:bg-accent/50 focus:outline-none focus:bg-accent/50 focus:border-primary/30"

// Content area
"flex-1 min-w-0 space-y-1.5"

// Primary/Secondary inputs (when editing)
"block w-full bg-transparent px-0 py-0 m-0 text-sm font-medium leading-relaxed text-foreground outline-none border-none break-words"

// Badges container
"flex flex-wrap items-center gap-1"
```

### Content Display Modes
- `wrap` (default): `break-words` - Text wraps to multiple lines
- `truncate`: `truncate` - Text cut off with ellipsis

## Migration Path

### Before (Current Pattern)
```tsx
// Parent manages ref array
const taskRefs = useRef<(HTMLDivElement | null)[]>([])
const refHandlers = useRef<...>([])

// Render task rows individually
{tasks.map((task, i) => (
  <TaskRow
    key={task.todoist_id}
    task={task}
    onElementRef={(el) => { taskRefs.current[i] = el }}
    onClick={() => onTaskClick(task)}
  />
))}

// TaskRow component (200+ lines)
function TaskRow({ task, onElementRef, onClick }) {
  const { isHovered, onMouseEnter, onMouseLeave } = useListItemHover()
  const editing = useListItemEditing({ ... })
  const { getTaskUpdate, ... } = useOptimisticUpdates()
  // ... 150+ lines of rendering logic ...
}
```

### After (BaseListItem Pattern)
```tsx
// Parent still manages ref array (same)
const taskRefs = useRef<(HTMLDivElement | null)[]>([])
const refHandlers = useRef<...>([])

// Render task items with BaseListItem
{tasks.map((task, i) => (
  <TaskListItem
    key={task.todoist_id}
    task={task}
    onElementRef={(el) => { taskRefs.current[i] = el }}
    onClick={() => onTaskClick(task)}
  />
))}

// TaskListItem wrapper component (50 lines)
function TaskListItem({ task, onElementRef, onClick }) {
  return (
    <BaseListItem<Task>
      entity={task}
      entityType="task"
      getEntityId={(t) => t.todoist_id}

      renderLeftElement={(isHovered) => <CheckboxButton ... />}
      renderPrimaryDisplay={(t) => <ParsedContent ... />}
      renderSecondaryDisplay={(t) => t.description ? ... : null}
      renderFixedBadges={(t, h) => <TaskBadges ... />}
      renderHoverBadges={(t) => <TaskHoverBadges ... />}

      primaryField={{ value: task.content, key: 'content' }}
      secondaryField={{ value: task.description, key: 'description' }}
      onSave={async (changes) => { ... }}

      onClick={onClick}
      onElementRef={onElementRef}
      contentDisplayMode="wrap"
    />
  )
}
```

## Success Criteria for Implementation

- ✅ Generic TypeScript support (compiles with zero errors)
- ✅ All render props are called with correct parameters
- ✅ Hover state works correctly
- ✅ Editing with keyboard shortcuts works
- ✅ Ref forwarding works for focus management
- ✅ Data attributes set correctly
- ✅ Styling matches current implementation
- ✅ Can be used by TaskListItem, ProjectListItem, RoutineListItem
