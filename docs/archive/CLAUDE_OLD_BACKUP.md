# Convex-DB Development Guide

This is the official development guide for the Personal Master Database System - a Convex-based centralized data hub that syncs with external services.

Call me Milad and tell me a fun fact of the day when starting a new conversation, so that I know that you read this CLAUDE.md file.

## Quick Start (30-second onboarding)

```bash
# Essential commands to get started
bun install && npx convex dev
npx convex run todoist:sync.runInitialSync
```

**Core development workflow**: Research → Plan → Implement → Validate

## Core Development Workflows

### Schema Changes (Critical Process)
Complete checklist for any database schema changes:

1. **Update Schema Definition**: `convex/schema/[service]/[table].ts`
2. **Create/Update Functions**: Create new mutations, queries, actions, or sync operations in appropriate directories
3. **Update Barrel Files**: Export new functions from barrel files (mutations.ts, queries.ts, etc.)
4. **Generate Types**: `npx convex dev` auto-generates TypeScript types (usually don't need manual type updates)
5. **Test Changes**: Clear data and re-sync to test new schema
6. **Validation Loop**: `bun tsc && bun run lint && bun test`

**Quick schema change commands:**
```bash
# Clear and re-sync for schema testing
npx convex run todoist:actions.clearAllData
npx convex run todoist:sync.runInitialSync
bun tsc && bun run lint && bun test
```

### Testing Patterns
- **Unit Tests Only**: Test business logic directly with vitest
- **Parallel Test Files**: Each function file has a corresponding `.test.ts` file
- **Simple Logic Testing**: Test data transformations, sorting, filtering logic

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
});
```

### Sync Debugging
```bash
# Essential debugging commands
npx convex run todoist:queries.getSyncStatus     # Check health
npx convex run todoist:sync.performIncrementalSync  # Force sync  
npx convex logs | grep ERROR                      # View errors
npx convex run todoist:actions.clearAllData      # Reset data
```

### Deployment Steps
```bash
# Pre-deployment validation
bun test && bun tsc && bun run lint

# Deploy to production
npx convex deploy

# Initialize production data
npx convex run --prod todoist:sync.runInitialSync
```

## Project Architecture

For detailed architecture patterns and principles: [docs/architecture.md](docs/architecture.md)

### Core Principles
1. **Data Integrity Above All**: Strong, reliable data layer with redundant sync
2. **External Services as Source of Truth**: Convex mirrors and caches data
3. **Three-Layer Sync Redundancy**: API responses + webhooks + periodic sync
4. **Integration Independence**: Each service developed separately
5. **Type Safety First**: No `any` types, strict TypeScript

### Quick Architecture Reference
```typescript
// Always use actions for external API calls
export const createTask = action({
  handler: async (ctx, args) => {
    const response = await todoistClient.create(args);
    await ctx.runMutation(internal.mutations.upsertItem, response);
    return response;
  }
});

// Mutations ensure data integrity with version checking
if (existing && existing.sync_version >= item.sync_version) {
  return; // Skip if we have newer data
}
```

## Service Integrations

### Todoist Integration
See [convex/todoist/README.md](convex/todoist/README.md) for detailed integration guide.

**Essential commands:**
```bash
# Create task
npx convex run todoist:actions.createTask '{"content": "Test task"}'

# Check sync health  
npx convex run todoist:queries.getSyncStatus

# View active items
npx convex run todoist:queries.getActiveItems
```

**Key Points:**
- Uses only Todoist API v1: `https://api.todoist.com/api/v1/*`
- Three-layer sync: API responses → webhooks → hourly cron
- Computed properties system for project metadata

## Agentic Development & Validation

For comprehensive validation loops and development patterns: [docs/agentic-development.md](docs/agentic-development.md)

### Validation Loop for All Changes
```bash
# Complete validation cycle
bun tsc && bun run lint && bun test

# Test with real data
npx convex run todoist:sync.performIncrementalSync

# Check for issues
npx convex logs | grep ERROR
```

### Standard Error Pattern (from actual codebase)
```typescript
// ActionResponse type from todoistClient.ts
export type ActionResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// Usage in actions
try {
  const client = getTodoistClient();
  const result = await client.addTask(args);
  await ctx.runMutation(internal.mutations.upsertItem, result);
  return { success: true, data: result };
} catch (error) {
  return { 
    success: false, 
    error: "Failed to create task",
    code: "TODOIST_API_ERROR"
  };
}
```

## Development Standards

### Code Quality (CRITICAL)
**Before ANY commit or PR:**
1. **TypeScript**: `bun tsc` - zero errors
2. **Linting**: `bun run lint` - zero errors  
3. **Tests**: `bun test` - all passing

### Type Safety Requirements
```typescript
// ✅ BEST: Use official SDKs with exported types
import { TodoistApi } from "@doist/todoist-api-typescript";
const client = new TodoistApi(token);
const task = await client.addTask({ content: "New task" });
// task is properly typed automatically

// ⚠️ When no SDK available, use unknown then narrow
const data: unknown = response;
if (typeof data === 'object' && data !== null && 'id' in data) {
  // Type guard to narrow
}

// ❌ NEVER use any
const data: any = response;
```

### JavaScript/TypeScript Runtime
**Use Bun as default:**
- `bun install` over `npm install`
- `bun run` for scripts
- `bunx` instead of `npx`
- Built-in TypeScript support

## Database Development

**Convex handles all database operations:**
- Schema defined in `convex/schema/`
- Types auto-generated when running `npx convex dev`
- No migrations needed - Convex handles schema evolution
- View data in Convex dashboard at `http://localhost:3001`

## Production Deployment

### Pre-Production Checklist
- [ ] All tests passing: `bun test`
- [ ] Type checking: `bun tsc`
- [ ] Linting: `bun run lint`
- [ ] Local testing with real data complete

### Production Commands
```bash
npx convex deploy
npx convex run --prod todoist:sync.runInitialSync
```

## Three-Layer Sync Architecture

### How It Works
1. **Immediate**: API response stored directly in Convex after action
2. **Real-time**: Webhook confirms/updates the change (milliseconds later)
3. **Backup**: Hourly cron sync catches anything missed

### Version Control Pattern (from actual codebase)
```typescript
// Mutations check sync versions to prevent overwrites
if (existing && existing.sync_version >= item.sync_version) {
  return; // Skip if we have newer data
}
```

## Task & Project Management

### TodoWrite for Development
Use TodoWrite tool for planning and tracking development tasks. Essential for:
- Breaking down complex features
- Tracking progress for user visibility
- Managing multi-step implementations

## Security & Performance

### Security Best Practices
- **Validate inputs**: Use Convex validators for all functions
- **Crypto/rand**: Use for randomness, not Math.random()
- **Prepared statements**: For any SQL (future use)
- **API key safety**: Store only in environment variables

### Performance Rules
- **Measure before optimizing**: No guessing
- **Use indexes**: For common query patterns
- **Batch operations**: Process multiple items together
- **Pagination**: For large result sets

## Problem Solving Patterns

**When stuck**: Stop. The simple solution is usually correct.

**When uncertain**: "Let me ultrathink about this architecture."

**When choosing**: "I see approach A (simple) vs B (flexible). Which do you prefer?"

## Documentation Standards

### Three-Document Development Workflow
For significant features:

1. **PRD**: Product Requirements Document - WHAT and WHY
2. **TDD**: Technical Design Document - HOW technically  
3. **Implementation Plan**: WHEN and in what ORDER

Use consistent project identifiers across docs and tasks.

### Documentation Organization
- Use Mermaid diagrams over ASCII art
- Keep technical designs focused on agentic patterns
- Reference supporting docs with clear links
- Prefer darker colors for diagrams (light gray text visibility)

## UI Development (Future)

### UI Development Philosophy
UIs are intentionally secondary to enable **quickly spun up interfaces** that leverage the strong data layer.

### Patterns When Building UI
- **Optimistic updates**: Always provide instant feedback
- **Real-time subscriptions**: Use Convex's reactive queries
- **Progressive enhancement**: Start basic, add features as needed
- **Component libraries**: Use shadcn/ui for speed

## Efficiency Maximization

### Parallel Operations
- Run multiple searches, reads, greps in single messages
- Use multiple agents for complex tasks
- Batch similar work together

### Best Practices
- **TodoWrite** for task management
- **Clear naming** in all code
- **Multiple tool calls** in single responses when possible
- **Agent specialization** for matching tasks

## Integration Development Standards

### Adding New Services
1. **Design Phase**: Document API capabilities, plan redundant sync
2. **Implementation**: Follow service structure pattern
3. **Testing**: Unit tests for sync mechanisms, integration tests with mocks
4. **Monitoring**: Implement health check queries

### Service Structure Template
```
convex/[service]/
├── actions/          # External API calls
├── mutations/        # Database operations  
├── queries/          # Data queries
├── sync/            # Sync orchestration
├── types/           # Type definitions
├── helpers/         # Utilities
└── README.md        # Service guide
```

Focus on maintainable solutions over clever abstractions. The strength of this system lies in its robust data layer - everything else builds upon that foundation.

---

## Key Files Reference

- [docs/architecture.md](docs/architecture.md) - System design, patterns, and file organization
- [docs/agentic-development.md](docs/agentic-development.md) - Validation loops and development patterns
- [convex/todoist/README.md](convex/todoist/README.md) - Todoist integration guide
- [docs/archive/](docs/archive/) - Historical documentation