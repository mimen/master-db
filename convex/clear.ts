import { mutation } from "./_generated/server";

export const all = mutation({
  handler: async (ctx) => {
    // Get all items and delete them
    const items = await ctx.db.query("todoist_items").collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }

    // Get all projects and delete them
    const projects = await ctx.db.query("todoist_projects").collect();
    for (const project of projects) {
      await ctx.db.delete(project._id);
    }

    // Get all sections and delete them
    const sections = await ctx.db.query("todoist_sections").collect();
    for (const section of sections) {
      await ctx.db.delete(section._id);
    }

    // Get all labels and delete them
    const labels = await ctx.db.query("todoist_labels").collect();
    for (const label of labels) {
      await ctx.db.delete(label._id);
    }

    // Get all notes and delete them
    const notes = await ctx.db.query("todoist_notes").collect();
    for (const note of notes) {
      await ctx.db.delete(note._id);
    }

    // Get all reminders and delete them
    const reminders = await ctx.db.query("todoist_reminders").collect();
    for (const reminder of reminders) {
      await ctx.db.delete(reminder._id);
    }

    // Get all sync states and delete them
    const syncStates = await ctx.db.query("sync_state").collect();
    for (const state of syncStates) {
      await ctx.db.delete(state._id);
    }

    console.log(`Cleared ${items.length} items, ${projects.length} projects, ${sections.length} sections, ${labels.length} labels, ${notes.length} notes, ${reminders.length} reminders, and ${syncStates.length} sync states`);
    
    return {
      itemsDeleted: items.length,
      projectsDeleted: projects.length,
      sectionsDeleted: sections.length,
      labelsDeleted: labels.length,
      notesDeleted: notes.length,
      remindersDeleted: reminders.length,
      syncStatesDeleted: syncStates.length,
    };
  },
});

export const items = mutation({
  handler: async (ctx) => {
    const items = await ctx.db.query("todoist_items").collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }

    console.log(`Cleared ${items.length} items`);
    
    return {
      itemsDeleted: items.length,
    };
  },
});

export const projects = mutation({
  handler: async (ctx) => {
    const projects = await ctx.db.query("todoist_projects").collect();
    for (const project of projects) {
      await ctx.db.delete(project._id);
    }

    console.log(`Cleared ${projects.length} projects`);
    
    return {
      projectsDeleted: projects.length,
    };
  },
});

export const syncState = mutation({
  handler: async (ctx) => {
    const syncStates = await ctx.db.query("sync_state").collect();
    for (const state of syncStates) {
      await ctx.db.delete(state._id);
    }

    console.log(`Cleared ${syncStates.length} sync states`);
    
    return {
      syncStatesDeleted: syncStates.length,
    };
  },
});