import { v } from "convex/values";

import { api } from "../../_generated/api";
import { action } from "../../_generated/server";
import type { ProjectMetadata, ProjectMetadataInput } from "../types/projectMetadata";

/**
 * Upserts project metadata for a given project.
 * Creates metadata if it doesn't exist, updates if it does.
 * This ensures every project can have metadata.
 */
export const updateProjectMetadata = action({
  args: {
    projectId: v.string(), // Todoist project ID
    priority: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4))),
    scheduledDate: v.optional(v.string()), // ISO date string
    description: v.optional(v.string()),
    projectType: v.optional(v.union(
      v.literal("area-of-responsibility"),
      v.literal("project-type")
    )),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    action: "updated" | "created";
    projectId: string;
    metadata?: ProjectMetadata;
    metadataId?: string;
  }> => {
    // First, verify the project exists
    const project = await ctx.runQuery(api.todoist.publicQueries.getProject, {
      projectId: args.projectId,
    });

    if (!project) {
      throw new Error(`Project with ID ${args.projectId} not found`);
    }

    // Check if metadata already exists
    const existingMetadata = await ctx.runQuery(
      api.todoist.publicQueries.getProjectMetadata,
      { projectId: args.projectId }
    );

    const metadataData: ProjectMetadataInput = {
      project_id: args.projectId,
      last_updated: Date.now(),
      sync_version: Date.now(),
    };

    // Only add optional fields if they have values
    if (args.priority !== undefined) metadataData.priority = args.priority;
    if (args.scheduledDate !== undefined) metadataData.scheduled_date = args.scheduledDate;
    if (args.description !== undefined) metadataData.description = args.description;
    if (args.projectType !== undefined) metadataData.project_type = args.projectType;

    if (existingMetadata) {
      // Update existing metadata
      await ctx.runMutation(
        api.todoist.publicMutations.updateProjectMetadata,
        {
          metadataId: existingMetadata._id,
          updates: metadataData,
        }
      );

      // Query the updated metadata
      const updatedMetadata = await ctx.runQuery(
        api.todoist.publicQueries.getProjectMetadata,
        { projectId: args.projectId }
      );

      return {
        success: true,
        action: "updated" as const,
        projectId: args.projectId,
        metadata: updatedMetadata || undefined,
      };
    } else {
      // Create new metadata
      const newMetadataId = await ctx.runMutation(
        api.todoist.publicMutations.createProjectMetadata,
        metadataData
      );

      // Query the created metadata
      const createdMetadata = await ctx.runQuery(
        api.todoist.publicQueries.getProjectMetadata,
        { projectId: args.projectId }
      );

      return {
        success: true,
        action: "created" as const,
        projectId: args.projectId,
        metadataId: newMetadataId,
        metadata: createdMetadata || undefined,
      };
    }
  },
});

/**
 * Batch update metadata for multiple projects.
 * Useful for bulk operations.
 */
export const batchUpdateProjectMetadata = action({
  args: {
    updates: v.array(
      v.object({
        projectId: v.string(),
        priority: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4))),
        scheduledDate: v.optional(v.string()),
        description: v.optional(v.string()),
        projectType: v.optional(v.union(
          v.literal("area-of-responsibility"),
          v.literal("project-type")
        )),
      })
    ),
  },
  handler: async (ctx, args): Promise<{
    totalUpdates: number;
    successful: number;
    failed: number;
    results: Array<{
      success: boolean;
      projectId: string;
      action?: "updated" | "created";
      metadata?: ProjectMetadata;
      metadataId?: string;
      error?: string;
    }>;
  }> => {
    const results: Array<{
      success: boolean;
      projectId: string;
      action?: "updated" | "created";
      metadata?: ProjectMetadata;
      metadataId?: string;
      error?: string;
    }> = [];

    for (const update of args.updates) {
      try {
        const result = await ctx.runAction(
          api.todoist.publicActions.updateProjectMetadata,
          update
        );
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          projectId: update.projectId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      totalUpdates: args.updates.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    };
  },
});

/**
 * Reset project metadata to defaults.
 * This doesn't delete the metadata, but resets all optional fields.
 * Useful when you want to clear custom settings while maintaining the record.
 */
export const resetProjectMetadata = action({
  args: {
    projectId: v.string(),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    projectId: string;
    message: string;
    metadata?: ProjectMetadata;
  }> => {
    // Get existing metadata
    const existingMetadata = await ctx.runQuery(
      api.todoist.publicQueries.getProjectMetadata,
      { projectId: args.projectId }
    );

    if (!existingMetadata) {
      // Create empty metadata if it doesn't exist
      await ctx.runMutation(
        api.todoist.publicMutations.createProjectMetadata,
        {
          project_id: args.projectId,
          last_updated: Date.now(),
          sync_version: Date.now(),
        }
      );

      return {
        success: true,
        projectId: args.projectId,
        message: "Metadata created with defaults",
      };
    }

    // Reset by replacing the entire document
    await ctx.runMutation(
      api.todoist.publicMutations.resetProjectMetadata,
      {
        metadataId: existingMetadata._id,
        projectId: args.projectId,
      }
    );

    return {
      success: true,
      projectId: args.projectId,
      message: "Metadata reset to defaults",
      metadata: (await ctx.runQuery(
        api.todoist.publicQueries.getProjectMetadata,
        { projectId: args.projectId }
      )) || undefined,
    };
  },
});