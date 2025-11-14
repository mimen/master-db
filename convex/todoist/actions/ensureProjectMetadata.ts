import { v } from "convex/values";

import { api } from "../../_generated/api";
import { action } from "../../_generated/server";
import type { ProjectMetadata } from "../types/projectMetadata";

/**
 * Ensures all projects have metadata entries.
 * Creates default metadata for projects that don't have any.
 * This can be called after sync operations to maintain consistency.
 */
export const ensureAllProjectsHaveMetadata = action({
  args: {},
  handler: async (ctx): Promise<{
    totalProjects: number;
    existingMetadata: number;
    createdMetadata: number;
    errors: { projectId: string; error: string }[];
  }> => {
    // Get all projects
    const projects = await ctx.runQuery(api.todoist.queries.getAllProjects.getAllProjects, {});

    const results = {
      totalProjects: projects.length,
      existingMetadata: 0,
      createdMetadata: 0,
      errors: [] as { projectId: string; error: string }[],
    };

    for (const project of projects) {
      try {
        // Check if metadata exists
        const metadata = await ctx.runQuery(
          api.todoist.queries.getProjectMetadata.getProjectMetadata,
          { projectId: project.todoist_id }
        );

        if (metadata) {
          results.existingMetadata++;
        } else {
          // Create default metadata
          await ctx.runMutation(
            api.todoist.publicMutations.createProjectMetadata,
            {
              project_id: project.todoist_id,
              last_updated: Date.now(),
              sync_version: Date.now(),
            }
          );
          results.createdMetadata++;
        }
      } catch (error) {
        results.errors.push({
          projectId: project.todoist_id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  },
});

/**
 * Ensures a single project has metadata.
 * Creates default metadata if it doesn't exist.
 */
export const ensureProjectHasMetadata = action({
  args: {
    projectId: v.string(),
  },
  handler: async (ctx, args): Promise<{
    created: boolean;
    metadata?: ProjectMetadata;
    metadataId?: string;
  }> => {
    // Check if metadata exists
    const metadata = await ctx.runQuery(
      api.todoist.queries.getProjectMetadata.getProjectMetadata,
      { projectId: args.projectId }
    );

    if (metadata) {
      return {
        created: false,
        metadata,
      };
    }

    // Create default metadata
    const metadataId = await ctx.runMutation(
      api.todoist.publicMutations.createProjectMetadata,
      {
        project_id: args.projectId,
        last_updated: Date.now(),
        sync_version: Date.now(),
      }
    );

    return {
      created: true,
      metadataId,
    };
  },
});