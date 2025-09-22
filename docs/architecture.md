# System Architecture

## Core Principles

### Data Integrity Above All
This project is built upon the backbone of a **strong, reliable data layer** that includes redundant methods of importing and keeping data in sync from multiple sources. The integrity of our data imports is the **top priority**.

### Master Database Concept
While external services remain the source of truth, our master database is designed to **mirror them as closely as possible**, creating a unified, queryable interface across all your personal data. This allows us to:
- Build cross-service queries and analytics
- Maintain data availability even when services are down
- Create powerful automations across different platforms
- Enable rapid UI experimentation

### Integration Independence
Each data integration is developed and maintained **separately** with emphasis on:
- Comprehensive testing for each integration
- Independent monitoring and health checks
- Service-specific error handling
- Modular architecture that doesn't affect other integrations

## Three-Layer Sync Architecture

Every integration implements **multiple sync mechanisms**:

1. **API Response Storage**: Immediate write after successful API calls
2. **Webhook Confirmation**: Real-time updates (milliseconds after changes)
3. **Periodic Sync**: Hourly cron job catches any missed updates

### Data Flow
```
User Action → Convex Action → External API → Store in Convex → UI Update (immediate)
                                    ↓
                            Webhook validates → Update if newer
                                    ↑
                            Hourly sync → Catch missed updates
```

## Service Integration Patterns

### Action Pattern
All external API calls go through actions that:
- Use official SDKs with exported types (e.g., `@doist/todoist-api-typescript`)
- Return standardized `ActionResponse<T>` types
- Update Convex database on success
- Handle errors gracefully

### Mutation Pattern
Database mutations ensure data integrity:
- Type-safe with Convex schemas
- Version checking prevents overwrites
- Soft deletion (never hard delete)
- Idempotent operations

### Query Pattern
Queries provide filtered, denormalized data:
- Real-time subscriptions via Convex
- Computed fields (e.g., item counts)
- Efficient indexing for performance

## Code Quality Requirements

### CRITICAL: Before Any Commit or PR
All code must pass these checks without errors:

1. **TypeScript Compilation**: `bun tsc` must pass with zero errors
2. **Linting**: `bun run lint` must pass with zero errors
3. **Tests**: `bun test` must pass all test suites

### Type Safety Requirements

**BEST: Use Official SDKs with Exported Types**
```typescript
import { TodoistApi } from "@doist/todoist-api-typescript";

// SDK provides all necessary types
const client = new TodoistApi(token);
const task = await client.addTask({ content: "New task" });
// task is properly typed automatically
```

**When SDKs unavailable, define proper types:**
```typescript
// ✅ Define explicit interfaces
interface ApiResponse {
  id: string;
  content: string;
}

// ⚠️ Use unknown for truly dynamic data, then narrow
const data: unknown = response;
if (typeof data === 'object' && data !== null && 'id' in data) {
  // Type guard to narrow the type
}

// ❌ NEVER use any
const data: any = response;
```

## File Organization Patterns

### Single File Per Change with Parallel Testing
- Each function/feature gets its own file
- Parallel test file with same name: `feature.ts` → `feature.test.ts`
- Keep functions small and focused
- Group related functionality into clear directories

### Service Structure
```
convex/[service]/
├── actions/          # API calls using official SDKs
│   ├── createTask.ts
│   ├── createTask.test.ts
│   └── utils/
│       └── todoistClient.ts
├── mutations/        # DB operations
│   ├── upsertItem.ts
│   └── upsertItem.test.ts
├── queries/          # Public queries
│   ├── getActiveItems.ts
│   └── getActiveItems.simple.test.ts
├── sync/             # Sync orchestration
├── types/            # Type definitions
└── README.md         # Service-specific guide
```

### Barrel File Updates
When creating new files, update barrel exports:
```typescript
// convex/[service]/mutations.ts
export { upsertItem } from "./mutations/upsertItem";
export { newMutation } from "./mutations/newMutation"; // Add new exports

// This allows imports like:
// import { upsertItem } from "../../mutations";
```

## Current Implementation: Todoist

### Official SDK Integration
```typescript
import { TodoistApi } from "@doist/todoist-api-typescript";

export const getTodoistClient = (): TodoistApi => {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) {
    throw new Error("TODOIST_API_TOKEN not configured");
  }
  return new TodoistApi(token);
};
```

### Type Safety with SDK
The Todoist SDK provides all necessary types, eliminating the need for custom type definitions for API responses.

### Computed Properties System
Extracts metadata from special Todoist tasks and pre-populates it for efficient querying.

## Testing Approach

### Unit Tests Only
- Test business logic directly (no integration tests)
- Each file has a parallel `.test.ts` file
- Use simple vitest patterns for logic validation

```typescript
// Example: getActiveItems.simple.test.ts
test('filtering logic for active items', () => {
  const allItems = [
    { todoist_id: '1', content: 'Active task', checked: 0, is_deleted: 0 },
    { todoist_id: '2', content: 'Completed task', checked: 1, is_deleted: 0 },
  ];
  
  const activeItems = allItems.filter(item => 
    item.checked === 0 && item.is_deleted === 0
  );
  
  expect(activeItems).toHaveLength(1);
  expect(activeItems[0].content).toBe('Active task');
});
```

### Note on convex-test
- `convex-test` is installed but currently disabled for Bun compatibility
- Simplified testing approach focuses on business logic
- Integration testing done manually through development workflow