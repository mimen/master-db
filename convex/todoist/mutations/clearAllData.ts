import { internalMutation } from "../../_generated/server";

export const clearAllData = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get all todoist-related tables
    const tables = [
      "todoist_items",
      "todoist_projects",
      "todoist_sections",
      "todoist_labels",
      "todoist_notes",
      "todoist_project_collaborators",
      "todoist_project_metadata",
      "todoist_reminders",
      "todoist_sync_state"
    ];

    // Clear each table
    for (const table of tables) {
      console.warn(`Clearing table: ${table}`);

      // Get all documents from the table
      // Note: We use 'any' here because we're iterating over multiple table names
      // and TypeScript can't verify all tables exist in the schema
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const documents = await ctx.db.query(table as any).collect();

      // Delete each document
      for (const doc of documents) {
        await ctx.db.delete(doc._id);
      }

      console.warn(`Cleared ${documents.length} documents from ${table}`);
    }

    return { success: true };
  },
});
