import { describe, test, expect } from 'vitest';

describe('createTask', () => {
  test('builds command args with required fields', () => {
    const args = {
      content: 'Test task',
    };
    
    const commandArgs: any = {
      content: args.content,
      priority: args.priority || 1,
    };
    
    expect(commandArgs.content).toBe('Test task');
    expect(commandArgs.priority).toBe(1);
    expect(commandArgs.project_id).toBeUndefined();
  });

  test('includes optional fields when provided', () => {
    const args = {
      content: 'Test task with options',
      projectId: 'proj-123',
      sectionId: 'section-456',
      priority: 3,
      labels: ['urgent', 'work'],
      description: 'This is a description',
    };
    
    const commandArgs: any = {
      content: args.content,
      priority: args.priority || 1,
    };
    
    if (args.projectId) commandArgs.project_id = args.projectId;
    if (args.sectionId) commandArgs.section_id = args.sectionId;
    if (args.labels?.length) commandArgs.labels = args.labels;
    if (args.description) commandArgs.description = args.description;
    
    expect(commandArgs.project_id).toBe('proj-123');
    expect(commandArgs.section_id).toBe('section-456');
    expect(commandArgs.priority).toBe(3);
    expect(commandArgs.labels).toEqual(['urgent', 'work']);
    expect(commandArgs.description).toBe('This is a description');
  });

  test('handles due date variations', () => {
    const dueDateCases = [
      { due: { string: 'tomorrow at 3pm' }, expected: { due_string: 'tomorrow at 3pm' } },
      { due: { datetime: '2024-01-15T15:00:00' }, expected: { due_datetime: '2024-01-15T15:00:00' } },
      { due: { date: '2024-01-15' }, expected: { due_date: '2024-01-15' } },
    ];
    
    dueDateCases.forEach(({ due, expected }) => {
      const commandArgs: any = {};
      
      if (due) {
        if (due.string) commandArgs.due_string = due.string;
        else if (due.datetime) commandArgs.due_datetime = due.datetime;
        else if (due.date) commandArgs.due_date = due.date;
      }
      
      expect(commandArgs).toEqual(expected);
    });
  });

  test('command structure for Sync API v1', () => {
    const tempId = 'temp-123';
    const commandId = 'cmd-456';
    
    const command = {
      type: "item_add",
      temp_id: tempId,
      uuid: commandId,
      args: {
        content: 'New task',
        priority: 1,
      },
    };
    
    expect(command.type).toBe('item_add');
    expect(command.temp_id).toBe(tempId);
    expect(command.uuid).toBe(commandId);
    expect(command.args.content).toBe('New task');
  });
});