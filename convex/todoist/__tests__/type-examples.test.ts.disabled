import type { FunctionArgs } from 'convex/server';
import { describe, test, expect } from 'vitest';

import { internal, api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';

/**
 * Examples of how to properly type test files using Convex's generated types
 */

// Example 1: Using FunctionArgs for typed mutation arguments
type UpsertItemArgs = FunctionArgs<typeof internal.todoist.mutations.upsertItem>;
// This gives us the exact argument types the mutation expects

// Example 2: Using generated database types
type TodoistItem = Doc<"todoist_items">;
// This gives us the exact database schema type

// Example 3: Using FunctionArgs for action arguments
type CreateTaskArgs = FunctionArgs<typeof api.todoist.actions.createTask>;
// This gives us the action's argument types

describe('Todoist Type Examples', () => {
  test('mutation args are fully typed', () => {
    // TypeScript knows the exact shape from our schema!
    const testItem: UpsertItemArgs['item'] = {
      id: '123',
      content: 'Test task',
      priority: 1,
      due: {
        date: '2024-01-01',
        string: 'tomorrow',
      },
      labels: ['urgent'],
    };

    expect(testItem.content).toBe('Test task');
    expect(testItem.due?.date).toBe('2024-01-01');
  });

  test('database types are generated from schema', () => {
    // Using the generated database type
    const dbItem: Partial<TodoistItem> = {
      todoist_id: '123',
      content: 'Test task',
      priority: 1,
      due: {
        date: '2024-01-01',
        is_recurring: false,
      },
    };

    expect(dbItem.todoist_id).toBe('123');
  });

  test('action args are typed from schema', () => {
    // Action arguments are also fully typed
    const createArgs: CreateTaskArgs = {
      content: 'New task',
      priority: 2,
      due: {
        date: '2024-01-01',
      },
    };

    expect(createArgs.content).toBe('New task');
  });
});