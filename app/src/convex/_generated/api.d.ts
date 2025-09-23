/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as clear from "../clear.js";
import type * as crons from "../crons.js";
import type * as schema_sync_syncState from "../schema/sync/syncState.js";
import type * as schema_todoist_collaborators from "../schema/todoist/collaborators.js";
import type * as schema_todoist_index from "../schema/todoist/index.js";
import type * as schema_todoist_items from "../schema/todoist/items.js";
import type * as schema_todoist_labels from "../schema/todoist/labels.js";
import type * as schema_todoist_notes from "../schema/todoist/notes.js";
import type * as schema_todoist_projectMetadata from "../schema/todoist/projectMetadata.js";
import type * as schema_todoist_projects from "../schema/todoist/projects.js";
import type * as schema_todoist_reminders from "../schema/todoist/reminders.js";
import type * as schema_todoist_sections from "../schema/todoist/sections.js";
import type * as todoist_actions_clearAllData from "../todoist/actions/clearAllData.js";
import type * as todoist_actions_completeMultipleTasks from "../todoist/actions/completeMultipleTasks.js";
import type * as todoist_actions_completeTask from "../todoist/actions/completeTask.js";
import type * as todoist_actions_createComment from "../todoist/actions/createComment.js";
import type * as todoist_actions_createLabel from "../todoist/actions/createLabel.js";
import type * as todoist_actions_createProject from "../todoist/actions/createProject.js";
import type * as todoist_actions_createSection from "../todoist/actions/createSection.js";
import type * as todoist_actions_createTask from "../todoist/actions/createTask.js";
import type * as todoist_actions_deleteComment from "../todoist/actions/deleteComment.js";
import type * as todoist_actions_deleteLabel from "../todoist/actions/deleteLabel.js";
import type * as todoist_actions_deleteProject from "../todoist/actions/deleteProject.js";
import type * as todoist_actions_deleteSection from "../todoist/actions/deleteSection.js";
import type * as todoist_actions_deleteTask from "../todoist/actions/deleteTask.js";
import type * as todoist_actions_duplicateTask from "../todoist/actions/duplicateTask.js";
import type * as todoist_actions_ensureProjectMetadata from "../todoist/actions/ensureProjectMetadata.js";
import type * as todoist_actions_moveTask from "../todoist/actions/moveTask.js";
import type * as todoist_actions_refreshProjectMetadata from "../todoist/actions/refreshProjectMetadata.js";
import type * as todoist_actions_reopenTask from "../todoist/actions/reopenTask.js";
import type * as todoist_actions_updateComment from "../todoist/actions/updateComment.js";
import type * as todoist_actions_updateLabel from "../todoist/actions/updateLabel.js";
import type * as todoist_actions_updateProject from "../todoist/actions/updateProject.js";
import type * as todoist_actions_updateProjectMetadata from "../todoist/actions/updateProjectMetadata.js";
import type * as todoist_actions_updateSection from "../todoist/actions/updateSection.js";
import type * as todoist_actions_updateTask from "../todoist/actions/updateTask.js";
import type * as todoist_actions_utils_todoistClient from "../todoist/actions/utils/todoistClient.js";
import type * as todoist_computed_index from "../todoist/computed/index.js";
import type * as todoist_computed_mutations_extractProjectMetadata from "../todoist/computed/mutations/extractProjectMetadata.js";
import type * as todoist_computed_mutations_triggerMetadataExtraction from "../todoist/computed/mutations/triggerMetadataExtraction.js";
import type * as todoist_computed_queries_getProjectsByPriority from "../todoist/computed/queries/getProjectsByPriority.js";
import type * as todoist_computed_queries_getProjectsWithMetadata from "../todoist/computed/queries/getProjectsWithMetadata.js";
import type * as todoist_computed_queries_getScheduledProjects from "../todoist/computed/queries/getScheduledProjects.js";
import type * as todoist_computed_queries_index from "../todoist/computed/queries/index.js";
import type * as todoist_computed from "../todoist/computed.js";
import type * as todoist_debug from "../todoist/debug.js";
import type * as todoist_helpers_computedProperties from "../todoist/helpers/computedProperties.js";
import type * as todoist_helpers_globalFilters from "../todoist/helpers/globalFilters.js";
import type * as todoist_internal_index from "../todoist/internal/index.js";
import type * as todoist_internal_queries_getRawActiveItems from "../todoist/internal/queries/getRawActiveItems.js";
import type * as todoist_internal_queries_getSyncState from "../todoist/internal/queries/getSyncState.js";
import type * as todoist_internal from "../todoist/internal.js";
import type * as todoist_mutations_clearAllData from "../todoist/mutations/clearAllData.js";
import type * as todoist_mutations_createProjectMetadata from "../todoist/mutations/createProjectMetadata.js";
import type * as todoist_mutations_initializeSyncState from "../todoist/mutations/initializeSyncState.js";
import type * as todoist_mutations_resetProjectMetadata from "../todoist/mutations/resetProjectMetadata.js";
import type * as todoist_mutations_updateItem from "../todoist/mutations/updateItem.js";
import type * as todoist_mutations_updateProjectMetadata from "../todoist/mutations/updateProjectMetadata.js";
import type * as todoist_mutations_updateSyncToken from "../todoist/mutations/updateSyncToken.js";
import type * as todoist_mutations_upsertItem from "../todoist/mutations/upsertItem.js";
import type * as todoist_mutations_upsertLabel from "../todoist/mutations/upsertLabel.js";
import type * as todoist_mutations_upsertNote from "../todoist/mutations/upsertNote.js";
import type * as todoist_mutations_upsertProject from "../todoist/mutations/upsertProject.js";
import type * as todoist_mutations_upsertReminder from "../todoist/mutations/upsertReminder.js";
import type * as todoist_mutations_upsertSection from "../todoist/mutations/upsertSection.js";
import type * as todoist_mutations from "../todoist/mutations.js";
import type * as todoist_publicActions from "../todoist/publicActions.js";
import type * as todoist_publicMutations from "../todoist/publicMutations.js";
import type * as todoist_publicQueries from "../todoist/publicQueries.js";
import type * as todoist_queries_getActiveItems from "../todoist/queries/getActiveItems.js";
import type * as todoist_queries_getAllProjects from "../todoist/queries/getAllProjects.js";
import type * as todoist_queries_getDueFutureItems from "../todoist/queries/getDueFutureItems.js";
import type * as todoist_queries_getDueNext7DaysItems from "../todoist/queries/getDueNext7DaysItems.js";
import type * as todoist_queries_getDueTodayItems from "../todoist/queries/getDueTodayItems.js";
import type * as todoist_queries_getDueTomorrowItems from "../todoist/queries/getDueTomorrowItems.js";
import type * as todoist_queries_getNoDueDateItems from "../todoist/queries/getNoDueDateItems.js";
import type * as todoist_queries_getOverdueItems from "../todoist/queries/getOverdueItems.js";
import type * as todoist_queries_getProject from "../todoist/queries/getProject.js";
import type * as todoist_queries_getProjectMetadata from "../todoist/queries/getProjectMetadata.js";
import type * as todoist_queries_getProjectTaskCounts from "../todoist/queries/getProjectTaskCounts.js";
import type * as todoist_queries_getProjectWithItemCount from "../todoist/queries/getProjectWithItemCount.js";
import type * as todoist_queries_getProjects from "../todoist/queries/getProjects.js";
import type * as todoist_queries_getSyncStatus from "../todoist/queries/getSyncStatus.js";
import type * as todoist_queries from "../todoist/queries.js";
import type * as todoist_sync_performIncrementalSync from "../todoist/sync/performIncrementalSync.js";
import type * as todoist_sync_runInitialSync from "../todoist/sync/runInitialSync.js";
import type * as todoist_sync from "../todoist/sync.js";
import type * as todoist_types_projectMetadata from "../todoist/types/projectMetadata.js";
import type * as todoist_types_syncApi from "../todoist/types/syncApi.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  clear: typeof clear;
  crons: typeof crons;
  "schema/sync/syncState": typeof schema_sync_syncState;
  "schema/todoist/collaborators": typeof schema_todoist_collaborators;
  "schema/todoist/index": typeof schema_todoist_index;
  "schema/todoist/items": typeof schema_todoist_items;
  "schema/todoist/labels": typeof schema_todoist_labels;
  "schema/todoist/notes": typeof schema_todoist_notes;
  "schema/todoist/projectMetadata": typeof schema_todoist_projectMetadata;
  "schema/todoist/projects": typeof schema_todoist_projects;
  "schema/todoist/reminders": typeof schema_todoist_reminders;
  "schema/todoist/sections": typeof schema_todoist_sections;
  "todoist/actions/clearAllData": typeof todoist_actions_clearAllData;
  "todoist/actions/completeMultipleTasks": typeof todoist_actions_completeMultipleTasks;
  "todoist/actions/completeTask": typeof todoist_actions_completeTask;
  "todoist/actions/createComment": typeof todoist_actions_createComment;
  "todoist/actions/createLabel": typeof todoist_actions_createLabel;
  "todoist/actions/createProject": typeof todoist_actions_createProject;
  "todoist/actions/createSection": typeof todoist_actions_createSection;
  "todoist/actions/createTask": typeof todoist_actions_createTask;
  "todoist/actions/deleteComment": typeof todoist_actions_deleteComment;
  "todoist/actions/deleteLabel": typeof todoist_actions_deleteLabel;
  "todoist/actions/deleteProject": typeof todoist_actions_deleteProject;
  "todoist/actions/deleteSection": typeof todoist_actions_deleteSection;
  "todoist/actions/deleteTask": typeof todoist_actions_deleteTask;
  "todoist/actions/duplicateTask": typeof todoist_actions_duplicateTask;
  "todoist/actions/ensureProjectMetadata": typeof todoist_actions_ensureProjectMetadata;
  "todoist/actions/moveTask": typeof todoist_actions_moveTask;
  "todoist/actions/refreshProjectMetadata": typeof todoist_actions_refreshProjectMetadata;
  "todoist/actions/reopenTask": typeof todoist_actions_reopenTask;
  "todoist/actions/updateComment": typeof todoist_actions_updateComment;
  "todoist/actions/updateLabel": typeof todoist_actions_updateLabel;
  "todoist/actions/updateProject": typeof todoist_actions_updateProject;
  "todoist/actions/updateProjectMetadata": typeof todoist_actions_updateProjectMetadata;
  "todoist/actions/updateSection": typeof todoist_actions_updateSection;
  "todoist/actions/updateTask": typeof todoist_actions_updateTask;
  "todoist/actions/utils/todoistClient": typeof todoist_actions_utils_todoistClient;
  "todoist/computed/index": typeof todoist_computed_index;
  "todoist/computed/mutations/extractProjectMetadata": typeof todoist_computed_mutations_extractProjectMetadata;
  "todoist/computed/mutations/triggerMetadataExtraction": typeof todoist_computed_mutations_triggerMetadataExtraction;
  "todoist/computed/queries/getProjectsByPriority": typeof todoist_computed_queries_getProjectsByPriority;
  "todoist/computed/queries/getProjectsWithMetadata": typeof todoist_computed_queries_getProjectsWithMetadata;
  "todoist/computed/queries/getScheduledProjects": typeof todoist_computed_queries_getScheduledProjects;
  "todoist/computed/queries/index": typeof todoist_computed_queries_index;
  "todoist/computed": typeof todoist_computed;
  "todoist/debug": typeof todoist_debug;
  "todoist/helpers/computedProperties": typeof todoist_helpers_computedProperties;
  "todoist/helpers/globalFilters": typeof todoist_helpers_globalFilters;
  "todoist/internal/index": typeof todoist_internal_index;
  "todoist/internal/queries/getRawActiveItems": typeof todoist_internal_queries_getRawActiveItems;
  "todoist/internal/queries/getSyncState": typeof todoist_internal_queries_getSyncState;
  "todoist/internal": typeof todoist_internal;
  "todoist/mutations/clearAllData": typeof todoist_mutations_clearAllData;
  "todoist/mutations/createProjectMetadata": typeof todoist_mutations_createProjectMetadata;
  "todoist/mutations/initializeSyncState": typeof todoist_mutations_initializeSyncState;
  "todoist/mutations/resetProjectMetadata": typeof todoist_mutations_resetProjectMetadata;
  "todoist/mutations/updateItem": typeof todoist_mutations_updateItem;
  "todoist/mutations/updateProjectMetadata": typeof todoist_mutations_updateProjectMetadata;
  "todoist/mutations/updateSyncToken": typeof todoist_mutations_updateSyncToken;
  "todoist/mutations/upsertItem": typeof todoist_mutations_upsertItem;
  "todoist/mutations/upsertLabel": typeof todoist_mutations_upsertLabel;
  "todoist/mutations/upsertNote": typeof todoist_mutations_upsertNote;
  "todoist/mutations/upsertProject": typeof todoist_mutations_upsertProject;
  "todoist/mutations/upsertReminder": typeof todoist_mutations_upsertReminder;
  "todoist/mutations/upsertSection": typeof todoist_mutations_upsertSection;
  "todoist/mutations": typeof todoist_mutations;
  "todoist/publicActions": typeof todoist_publicActions;
  "todoist/publicMutations": typeof todoist_publicMutations;
  "todoist/publicQueries": typeof todoist_publicQueries;
  "todoist/queries/getActiveItems": typeof todoist_queries_getActiveItems;
  "todoist/queries/getAllProjects": typeof todoist_queries_getAllProjects;
  "todoist/queries/getDueFutureItems": typeof todoist_queries_getDueFutureItems;
  "todoist/queries/getDueNext7DaysItems": typeof todoist_queries_getDueNext7DaysItems;
  "todoist/queries/getDueTodayItems": typeof todoist_queries_getDueTodayItems;
  "todoist/queries/getDueTomorrowItems": typeof todoist_queries_getDueTomorrowItems;
  "todoist/queries/getNoDueDateItems": typeof todoist_queries_getNoDueDateItems;
  "todoist/queries/getOverdueItems": typeof todoist_queries_getOverdueItems;
  "todoist/queries/getProject": typeof todoist_queries_getProject;
  "todoist/queries/getProjectMetadata": typeof todoist_queries_getProjectMetadata;
  "todoist/queries/getProjectTaskCounts": typeof todoist_queries_getProjectTaskCounts;
  "todoist/queries/getProjectWithItemCount": typeof todoist_queries_getProjectWithItemCount;
  "todoist/queries/getProjects": typeof todoist_queries_getProjects;
  "todoist/queries/getSyncStatus": typeof todoist_queries_getSyncStatus;
  "todoist/queries": typeof todoist_queries;
  "todoist/sync/performIncrementalSync": typeof todoist_sync_performIncrementalSync;
  "todoist/sync/runInitialSync": typeof todoist_sync_runInitialSync;
  "todoist/sync": typeof todoist_sync;
  "todoist/types/projectMetadata": typeof todoist_types_projectMetadata;
  "todoist/types/syncApi": typeof todoist_types_syncApi;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
