# Prioritized Queue Feature Documentation

## Overview

The Prioritized Queue system is a sophisticated task processing mechanism that presents tasks in a carefully ordered sequence based on multiple configurable criteria. This document provides a complete specification for porting this feature to other projects.

## Core Concept

The prioritized queue transforms a large, overwhelming task list into a manageable, sequential workflow where users process one task at a time in order of importance.

### Key Benefits
- **Reduces decision fatigue** - System determines task order
- **Enforces focus** - Single task presentation
- **Flexible prioritization** - Multiple queue types for different contexts
- **Smooth progression** - Natural flow between queue segments

## Architecture Components

### 1. Queue Configuration System

The queue system is configuration-driven, allowing easy customization without code changes.

#### Configuration Structure
```json
{
  "queues": [
    {
      "id": "project-priority",
      "name": "Project Priority Queue",
      "description": "Tasks ordered by project priority, then task priority",
      "filters": [
        {
          "type": "project",
          "projectIds": ["work", "personal"],
          "includeSubprojects": true
        }
      ],
      "ordering": [
        { "field": "projectPriority", "direction": "desc" },
        { "field": "taskPriority", "direction": "desc" },
        { "field": "dueDate", "direction": "asc" }
      ],
      "grouping": {
        "field": "projectId",
        "showHeaders": true
      }
    }
  ]
}
```

### 2. Filter System

Filters determine which tasks appear in a queue. Multiple filter types can be combined:

#### Filter Types
- **Project Filter** - Include/exclude specific projects
- **Priority Filter** - Minimum priority threshold
- **Label Filter** - Required or excluded labels
- **Date Filter** - Due date ranges
- **Custom Filter** - Complex conditions (e.g., "overdue", "no date")
- **Assignee Filter** - Include/exclude assigned tasks

#### Filter Logic
```typescript
interface Filter {
  type: 'project' | 'priority' | 'label' | 'date' | 'custom' | 'assignee';
  mode?: 'include' | 'exclude';
  // Type-specific properties
}

// Filters are combined with AND logic
// Within a filter type, options use OR logic
```

### 3. Ordering System

Tasks that pass filters are ordered by multiple criteria:

#### Ordering Fields
- `projectPriority` - Priority assigned to the project
- `taskPriority` - Individual task priority (P1-P4)
- `dueDate` - Task due date
- `createdDate` - When task was created
- `projectOrder` - Manual project ordering
- `labelPriority` - Highest priority among task labels

#### Multi-Level Sorting
```typescript
interface OrderingRule {
  field: string;
  direction: 'asc' | 'desc';
  nullsFirst?: boolean; // How to handle missing values
}

// Applied in sequence - first rule is primary sort
ordering: OrderingRule[]
```

### 4. Grouping System

Tasks can be visually grouped while maintaining overall order:

```typescript
interface GroupingConfig {
  field: 'projectId' | 'priority' | 'dueDate';
  showHeaders: boolean;
  collapsible?: boolean;
}
```

### 5. Queue Progression

The system tracks progress through the queue and offers natural break points:

#### Progression States
1. **Start of Queue** - Welcome message, queue overview
2. **Processing** - One task at a time
3. **Group Boundary** - "Moving to next project" transitions
4. **Milestone** - Every N tasks, offer a break
5. **End of Queue** - Completion message, next queue suggestion

#### Progression Logic
```typescript
interface QueueState {
  currentIndex: number;
  totalTasks: number;
  currentGroup?: string;
  tasksInGroup: number;
  tasksProcessedInGroup: number;
  sessionTasksProcessed: number;
}

// Triggers for progression prompts
const shouldShowProgression = (state: QueueState) => {
  if (state.tasksProcessedInGroup === state.tasksInGroup) {
    return { type: 'group-complete', nextGroup: getNextGroup(state) };
  }
  if (state.sessionTasksProcessed % 10 === 0) {
    return { type: 'milestone', count: state.sessionTasksProcessed };
  }
  return null;
};
```

## User Interface Design

### 1. Task Presentation

Tasks are presented one at a time in a focused view:

```typescript
interface TaskPresentation {
  // Core task data
  task: Task;
  
  // Context information
  queuePosition: number;
  totalInQueue: number;
  groupName?: string;
  progressInGroup?: { current: number; total: number };
  
  // Visual indicators
  priorityColor: string;
  dueDateWarning?: 'overdue' | 'today' | 'tomorrow';
}
```

### 2. Action Interface

Users can perform actions without leaving the queue flow:

#### Primary Actions
- **Done** - Mark complete and advance
- **Skip** - Move to next without completing
- **Edit** - Quick edit mode
- **Schedule** - Reschedule for later

#### Batch Actions (with multi-select)
- Apply label to multiple tasks
- Move tasks to project
- Bulk reschedule

### 3. Queue Navigation

```typescript
interface QueueNavigation {
  canGoBack: boolean;
  canGoForward: boolean;
  jumpToGroup: (groupId: string) => void;
  switchQueue: (queueId: string) => void;
  exitQueue: () => void;
}
```

## Implementation Patterns

### 1. State Management

```typescript
interface QueueSystemState {
  // Configuration
  availableQueues: QueueConfig[];
  activeQueueId: string | null;
  
  // Task data
  queueTasks: Task[]; // Filtered and ordered
  currentIndex: number;
  
  // User preferences
  sessionStartTime: Date;
  tasksProcessedCount: number;
  skippedTaskIds: Set<string>;
}
```

### 2. Task Loading Strategy

```typescript
// Load tasks in chunks for performance
const CHUNK_SIZE = 50;

interface TaskLoader {
  loadInitialChunk(): Promise<Task[]>;
  loadNextChunk(): Promise<Task[]>;
  preloadNextTasks(count: number): void;
}
```

### 3. Real-time Updates

```typescript
interface QueueUpdates {
  // Handle task changes while in queue
  onTaskUpdated: (taskId: string, changes: Partial<Task>) => void;
  onTaskDeleted: (taskId: string) => void;
  onTaskAdded: (task: Task) => void;
  
  // Reorder queue if needed
  shouldReorderQueue: (change: QueueChange) => boolean;
  reorderQueue: () => void;
}
```

## Advanced Features

### 1. Smart Queue Selection

Recommend the most relevant queue based on:
- Time of day
- Day of week  
- Recent activity
- Task characteristics

```typescript
interface QueueRecommendation {
  queueId: string;
  confidence: number; // 0-1
  reasoning: string;
}
```

### 2. Queue Mixing

Combine multiple queues with ratios:

```typescript
interface MixedQueue {
  name: "Mixed Daily Queue";
  sources: [
    { queueId: "urgent", ratio: 0.3 },
    { queueId: "important", ratio: 0.5 },
    { queueId: "quick-wins", ratio: 0.2 }
  ];
}
```

### 3. Time-boxed Queues

Limit queue processing by time:

```typescript
interface TimeBoxedQueue {
  baseQueueId: string;
  timeLimit: number; // minutes
  breakReminders: number[]; // minutes
}
```

## Performance Considerations

### 1. Filtering Performance

```typescript
// Use indexes for common filters
interface OptimizedFilters {
  // Pre-compute filter results
  projectIndex: Map<string, Set<string>>; // projectId -> taskIds
  priorityIndex: Map<number, Set<string>>; // priority -> taskIds
  labelIndex: Map<string, Set<string>>; // label -> taskIds
  
  // Efficient filter combining
  intersectFilters(filters: Filter[]): Set<string>;
}
```

### 2. Sorting Optimization

```typescript
// Cache sort keys
interface SortKeyCache {
  taskId: string;
  projectPriority: number;
  taskPriority: number;
  dueDateTimestamp: number | null;
}

// Pre-compute and cache complex sort values
```

### 3. Incremental Loading

```typescript
interface IncrementalLoader {
  // Virtual list approach
  visibleRange: { start: number; end: number };
  loadedRanges: Array<{ start: number; end: number }>;
  
  // Load only what's needed
  ensureLoaded(index: number, buffer: number): Promise<void>;
}
```

## Configuration Examples

### Example 1: Daily Review Queue
```json
{
  "id": "daily-review",
  "name": "Daily Review",
  "filters": [
    { "type": "custom", "condition": "overdue" },
    { "type": "date", "range": "today" },
    { "type": "label", "labels": ["waiting"], "mode": "exclude" }
  ],
  "ordering": [
    { "field": "taskPriority", "direction": "desc" },
    { "field": "dueDate", "direction": "asc" }
  ]
}
```

### Example 2: Project-Focused Queue
```json
{
  "id": "project-focus",
  "name": "Project Focus",
  "filters": [
    { "type": "project", "projectIds": ["PROJECT_ID"] }
  ],
  "ordering": [
    { "field": "taskPriority", "direction": "desc" }
  ],
  "grouping": {
    "field": "section",
    "showHeaders": true
  }
}
```

### Example 3: Quick Wins Queue
```json
{
  "id": "quick-wins",
  "name": "Quick Wins",
  "filters": [
    { "type": "label", "labels": ["quick", "easy", "5min"] },
    { "type": "custom", "condition": "no-date" }
  ],
  "ordering": [
    { "field": "createdDate", "direction": "desc" }
  ]
}
```

## Migration Checklist

When porting this feature:

- [ ] **Data Model**
  - [ ] Task structure with all required fields
  - [ ] Project hierarchy and metadata
  - [ ] Label system with priorities
  
- [ ] **Configuration System**
  - [ ] Queue configuration schema
  - [ ] Configuration validation
  - [ ] Default queue templates
  
- [ ] **Filter Engine**
  - [ ] All filter types implemented
  - [ ] Filter combination logic
  - [ ] Performance optimization
  
- [ ] **Ordering System**
  - [ ] Multi-field sorting
  - [ ] Null value handling
  - [ ] Sort key caching
  
- [ ] **UI Components**
  - [ ] Task card presentation
  - [ ] Queue progress indicators
  - [ ] Navigation controls
  - [ ] Keyboard shortcuts
  
- [ ] **State Management**
  - [ ] Queue state tracking
  - [ ] Progress persistence
  - [ ] Real-time updates
  
- [ ] **Performance**
  - [ ] Incremental loading
  - [ ] Virtual scrolling (if showing list)
  - [ ] Optimistic updates

## Conclusion

The Prioritized Queue system transforms task management from an overwhelming list into a guided, focused workflow. By implementing configurable filters, intelligent ordering, and thoughtful progression mechanics, it helps users maintain productivity while reducing cognitive load.

The key to successful implementation is maintaining flexibility through configuration while ensuring excellent performance through careful optimization of filtering and sorting operations.