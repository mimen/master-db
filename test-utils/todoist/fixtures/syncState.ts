export function createMockSyncState(overrides = {}) {
  return {
    service: 'todoist',
    last_full_sync: new Date().toISOString(),
    last_incremental_sync: new Date().toISOString(),
    last_sync_token: 'test-sync-token-123',
    initialized: true,
    ...overrides,
  };
}