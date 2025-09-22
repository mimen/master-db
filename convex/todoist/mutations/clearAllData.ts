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
      console.log(`Clearing table: ${table}`);
      
      // Get all documents from the table
      const documents = await ctx.db.query(table as any).collect();
      
      // Delete each document
      for (const doc of documents) {
        await ctx.db.delete(doc._id);
      }
      
      console.log(`Cleared ${documents.length} documents from ${table}`);
    }
    
    return { success: true };
  },
});