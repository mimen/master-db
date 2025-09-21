// No types needed for assertion functions - they work with basic TypeScript types
import { expect } from 'vitest';

/**
 * Custom assertions for Todoist data structures
 */

export function assertValidTodoistId(id: string) {
  expect(id).toBeTruthy();
  expect(typeof id).toBe('string');
  expect(id.length).toBeGreaterThan(0);
}

export function assertValidTimestamp(timestamp: string | null) {
  expect(timestamp).toBeTruthy();
  if (timestamp) {
    const date = new Date(timestamp);
    expect(date.getTime()).toBeGreaterThan(0);
    expect(date.getTime()).toBeLessThanOrEqual(Date.now());
  }
}

export function assertValidSyncVersion(version: number) {
  expect(typeof version).toBe('number');
  expect(version).toBeGreaterThan(0);
}

export function assertValidBooleanFlag(flag: boolean | number) {
  expect([0, 1]).toContain(flag);
}

export function assertValidPriority(priority: number) {
  expect(typeof priority).toBe('number');
  expect(priority).toBeGreaterThanOrEqual(1);
  expect(priority).toBeLessThanOrEqual(4);
}

export function assertValidColor(color: string) {
  const validColors = [
    'berry_red', 'light_blue', 'red', 'blue', 'orange',
    'grape', 'yellow', 'violet', 'olive_green', 'lavender',
    'lime_green', 'magenta', 'green', 'salmon', 'mint_green',
    'charcoal', 'teal', 'grey', 'sky_blue'
  ];
  expect(validColors).toContain(color);
}