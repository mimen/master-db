/**
 * Custom assertions for Todoist data structures
 */

export function assertValidTodoistId(id: any) {
  expect(id).toBeTruthy();
  expect(typeof id).toBe('string');
  expect(id.length).toBeGreaterThan(0);
}

export function assertValidTimestamp(timestamp: any) {
  expect(timestamp).toBeTruthy();
  const date = new Date(timestamp);
  expect(date.getTime()).toBeGreaterThan(0);
  expect(date.getTime()).toBeLessThanOrEqual(Date.now());
}

export function assertValidSyncVersion(version: any) {
  expect(typeof version).toBe('number');
  expect(version).toBeGreaterThan(0);
}

export function assertValidBooleanFlag(flag: any) {
  expect([0, 1]).toContain(flag);
}

export function assertValidPriority(priority: any) {
  expect(typeof priority).toBe('number');
  expect(priority).toBeGreaterThanOrEqual(1);
  expect(priority).toBeLessThanOrEqual(4);
}

export function assertValidColor(color: any) {
  const validColors = [
    'berry_red', 'light_blue', 'red', 'blue', 'orange', 
    'grape', 'yellow', 'violet', 'olive_green', 'lavender',
    'lime_green', 'magenta', 'green', 'salmon', 'mint_green',
    'charcoal', 'teal', 'grey', 'sky_blue'
  ];
  expect(validColors).toContain(color);
}