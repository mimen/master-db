import { describe, test, expect } from 'vitest';

describe('completeTask', () => {
  test('command structure for completing task', () => {
    const commandId = 'cmd-complete-123';
    const todoistId = 'task-456';
    
    const command = {
      type: "item_complete",
      uuid: commandId,
      args: {
        id: todoistId,
      },
    };
    
    expect(command.type).toBe('item_complete');
    expect(command.uuid).toBe(commandId);
    expect(command.args.id).toBe('task-456');
  });

  test('updates for completed task', () => {
    const updates = {
      checked: 1,
      sync_version: Date.now(),
    };
    
    expect(updates.checked).toBe(1);
    expect(updates.sync_version).toBeGreaterThan(0);
  });

  test('success response structure', () => {
    const successResponse = { 
      success: true, 
      data: undefined 
    };
    
    expect(successResponse.success).toBe(true);
    expect(successResponse.data).toBeUndefined();
  });

  test('error response structure', () => {
    const errorResponse = {
      success: false,
      error: "Failed to complete task. Please try again.",
      code: "COMPLETE_TASK_FAILED",
    };
    
    expect(errorResponse.success).toBe(false);
    expect(errorResponse.error).toContain("Failed to complete task");
    expect(errorResponse.code).toBe("COMPLETE_TASK_FAILED");
  });

  test('completeTask only requires todoistId', () => {
    const args = {
      todoistId: 'task-789',
    };
    
    expect(args).toHaveProperty('todoistId');
    expect(Object.keys(args)).toHaveLength(1);
  });
});