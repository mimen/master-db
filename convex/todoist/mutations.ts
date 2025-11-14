// Barrel export for all INTERNAL mutations only
// Note: Public mutations are exported from publicMutations.ts instead
export { initializeSyncState } from "./_mutations/initializeSyncState";
export { upsertProject } from "./_mutations/upsertProject";
export { upsertItem } from "./_mutations/upsertItem";
export { upsertSection } from "./_mutations/upsertSection";
export { upsertLabel } from "./_mutations/upsertLabel";
export { upsertNote } from "./_mutations/upsertNote";
export { upsertReminder } from "./_mutations/upsertReminder";
export { updateSyncToken } from "./_mutations/updateSyncToken";
export { updateItem } from "./_mutations/updateItem";
export { clearAllData } from "./_mutations/clearAllData";

// Note: The following are exported from publicMutations.ts, not here:
// - createProjectMetadata
// - updateProjectMetadata
// - resetProjectMetadata
// - createQueueState
// - updateQueueProgress

// Computed mutations
export { extractProjectMetadata } from "./computed/_mutations/extractProjectMetadata";
export { triggerMetadataExtraction } from "./computed/_mutations/triggerMetadataExtraction";

// Webhook mutations
export { logWebhookEvent } from "./_mutations/logWebhookEvent";