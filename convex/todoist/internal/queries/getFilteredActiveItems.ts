import { v } from "convex/values";

import { Doc } from "../../../_generated/dataModel";
import { internalQuery } from "../../../_generated/server";
import { SYSTEM_EXCLUDED_LABELS } from "../../helpers/globalFilters";

export const getFilteredActiveItems = internalQuery({
  args: {
    projectId: v.optional(v.string()),
    assigneeFilter: v.optional(
      v.union(
        v.literal('all'),
        v.literal('unassigned'),
        v.literal('assigned-to-me'),
        v.literal('assigned-to-others'),
        v.literal('not-assigned-to-others')
      )
    ),
    currentUserId: v.optional(v.string()),
    priority: v.optional(v.number()),
    limit: v.optional(v.number()),
    includeCompleted: v.optional(v.boolean()),
    includeStarPrefix: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const assigneeFilter = args.assigneeFilter || 'not-assigned-to-others';
    const includeCompleted = args.includeCompleted || false;
    const includeStarPrefix = args.includeStarPrefix || false;

    let items: Doc<"todoist_items">[];
    
    if (includeCompleted) {
      let q = ctx.db
        .query("todoist_items")
        .filter((q) => q.eq(q.field("is_deleted"), false));
      
      if (args.projectId) {
        q = q.filter((q) => q.eq(q.field("project_id"), args.projectId));
      }
      
      if (args.priority !== undefined) {
        q = q.filter((q) => q.eq(q.field("priority"), args.priority));
      }
      
      if (assigneeFilter === 'unassigned') {
        q = q.filter((q) => q.eq(q.field("assignee_id"), undefined));
      } else if (assigneeFilter === 'assigned-to-me' && args.currentUserId) {
        q = q.filter((q) => q.eq(q.field("assignee_id"), args.currentUserId));
      }
      
      items = await q.collect();
    } else {
      let q = ctx.db
        .query("todoist_items")
        .withIndex("active_items", (q) => 
          q.eq("is_deleted", false).eq("checked", false)
        );

      if (args.projectId) {
        q = q.filter((q) => q.eq(q.field("project_id"), args.projectId));
      }

      if (args.priority !== undefined) {
        q = q.filter((q) => q.eq(q.field("priority"), args.priority));
      }

      if (assigneeFilter === 'unassigned') {
        q = q.filter((q) => q.eq(q.field("assignee_id"), undefined));
      } else if (assigneeFilter === 'assigned-to-me' && args.currentUserId) {
        q = q.filter((q) => q.eq(q.field("assignee_id"), args.currentUserId));
      }

      items = await q.collect();
    }

    const filteredItems = items.filter((item: Doc<"todoist_items">) => {
      if (!includeStarPrefix && item.content.startsWith('* ')) {
        return false;
      }

      if (item.labels.some(label => SYSTEM_EXCLUDED_LABELS.includes(label as typeof SYSTEM_EXCLUDED_LABELS[number]))) {
        return false;
      }

      if (assigneeFilter === 'assigned-to-others') {
        if (!item.assignee_id || item.assignee_id === args.currentUserId) {
          return false;
        }
      }

      if (assigneeFilter === 'not-assigned-to-others') {
        if (item.assignee_id && item.assignee_id !== args.currentUserId) {
          return false;
        }
      }

      return true;
    });

    const sortedItems = filteredItems.sort((a, b) => a.child_order - b.child_order);

    if (args.limit && args.limit > 0) {
      return sortedItems.slice(0, args.limit);
    }

    return sortedItems;
  },
});
