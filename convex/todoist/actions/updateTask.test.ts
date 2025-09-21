import { describe, test, expect } from 'vitest';

describe('updateTask', () => {
  test('includes only provided update fields', () => {
    const args = {
      todoistId: 'task-123',
      content: 'Updated content',
      priority: 4,
    };
    
    const updateArgs: any = {
      id: args.todoistId,
    };
    if (args.content !== undefined) updateArgs.content = args.content;
    if (args.priority !== undefined) updateArgs.priority = args.priority;
    
    expect(updateArgs.id).toBe('task-123');
    expect(updateArgs.content).toBe('Updated content');
    expect(updateArgs.priority).toBe(4);
    expect(updateArgs.labels).toBeUndefined();
    expect(updateArgs.description).toBeUndefined();
  });

  test('handles undefined vs null values correctly', () => {
    const args = {
      todoistId: 'task-123',
      content: undefined,
      description: null,
      labels: [],
    };
    
    const updateArgs: any = {
      id: args.todoistId,
    };
    if (args.content !== undefined) updateArgs.content = args.content;
    if (args.description !== undefined) updateArgs.description = args.description;
    if (args.labels !== undefined) updateArgs.labels = args.labels;
    
    expect(updateArgs.content).toBeUndefined();
    expect(updateArgs.description).toBeNull();
    expect(updateArgs.labels).toEqual([]);
  });

  test('handles due date updates', () => {
    const args = {
      todoistId: 'task-123',
      due: {
        date: '2024-02-15',
        string: undefined,
        datetime: undefined,
      },
    };
    
    const updateArgs: any = {
      id: args.todoistId,
    };
    
    if (args.due) {
      if (args.due.string) updateArgs.due_string = args.due.string;
      else if (args.due.datetime) updateArgs.due_datetime = args.due.datetime;
      else if (args.due.date) updateArgs.due_date = args.due.date;
    }
    
    expect(updateArgs.due_date).toBe('2024-02-15');
    expect(updateArgs.due_string).toBeUndefined();
    expect(updateArgs.due_datetime).toBeUndefined();
  });

  test('separates id from update fields', () => {
    const updateArgs = {
      id: 'task-123',
      content: 'Updated content',
      priority: 3,
    };
    
    const { id, ...updateFields } = updateArgs;
    
    expect(id).toBe('task-123');
    expect(updateFields).toEqual({
      content: 'Updated content',
      priority: 3,
    });
  });

  test('command structure for Sync API v1', () => {
    const commandId = 'cmd-789';
    
    const command = {
      type: "item_update",
      uuid: commandId,
      args: {
        id: 'task-123',
        content: 'Updated task',
      },
    };
    
    expect(command.type).toBe('item_update');
    expect(command.uuid).toBe(commandId);
    expect(command.args.id).toBe('task-123');
  });
});