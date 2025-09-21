import { ConvexTestingHelper } from 'convex-test';

export async function seedDatabase(t: ConvexTestingHelper, data: {
  items?: any[],
  projects?: any[],
  sections?: any[]
}) {
  await t.run(async (ctx) => {
    if (data.projects) {
      for (const project of data.projects) {
        await ctx.db.insert('todoist_projects', project);
      }
    }

    if (data.sections) {
      for (const section of data.sections) {
        await ctx.db.insert('todoist_sections', section);
      }
    }

    if (data.items) {
      for (const item of data.items) {
        await ctx.db.insert('todoist_items', item);
      }
    }
  });
}

export async function cleanDatabase(t: ConvexTestingHelper) {
  await t.run(async (ctx) => {
    // Clean all Todoist tables
    const tables = [
      'todoist_items',
      'todoist_projects',
      'todoist_sections',
      'todoist_labels',
      'todoist_notes',
      'todoist_reminders'
    ];

    for (const table of tables) {
      const items = await ctx.db.query(table).collect();
      for (const item of items) {
        await ctx.db.delete(item._id);
      }
    }
  });
}