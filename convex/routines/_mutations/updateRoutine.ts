import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { Frequency } from "../types/frequency";
import { Duration } from "../types/duration";

export const updateRoutine = internalMutation({
  args: {
    routineId: v.id("routines"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    frequency: v.optional(
      v.union(
        v.literal(Frequency.Daily),
        v.literal(Frequency.TwiceAWeek),
        v.literal(Frequency.Weekly),
        v.literal(Frequency.EveryOtherWeek),
        v.literal(Frequency.Monthly),
        v.literal(Frequency.EveryOtherMonth),
        v.literal(Frequency.Quarterly),
        v.literal(Frequency.TwiceAYear),
        v.literal(Frequency.Yearly),
        v.literal(Frequency.EveryOtherYear)
      )
    ),
    duration: v.optional(
      v.union(
        v.literal(Duration.FiveMin),
        v.literal(Duration.FifteenMin),
        v.literal(Duration.ThirtyMin),
        v.literal(Duration.FortyFiveMin),
        v.literal(Duration.OneHour),
        v.literal(Duration.TwoHours),
        v.literal(Duration.ThreeHours),
        v.literal(Duration.FourHours)
      )
    ),
    timeOfDay: v.optional(
      v.union(
        v.literal("Morning"),
        v.literal("Day"),
        v.literal("Evening"),
        v.literal("Night")
      )
    ),
    idealDay: v.optional(v.number()), // 0-6 for Sunday-Saturday
    todoistProjectId: v.optional(v.string()),
    todoistLabels: v.optional(v.array(v.string())),
    priority: v.optional(v.number()), // 1-4
  },
  handler: async (ctx, { routineId, ...updates }) => {
    const routine = await ctx.db.get(routineId);
    if (!routine) {
      throw new Error(`Routine ${routineId} not found`);
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined)
      updateData.description = updates.description;
    if (updates.category !== undefined) updateData.category = updates.category;
    if (updates.frequency !== undefined)
      updateData.frequency = updates.frequency;
    if (updates.duration !== undefined) updateData.duration = updates.duration;
    if (updates.timeOfDay !== undefined)
      updateData.timeOfDay = updates.timeOfDay;
    if (updates.idealDay !== undefined) updateData.idealDay = updates.idealDay;
    if (updates.todoistProjectId !== undefined)
      updateData.todoistProjectId = updates.todoistProjectId;
    if (updates.todoistLabels !== undefined)
      updateData.todoistLabels = updates.todoistLabels;
    if (updates.priority !== undefined) updateData.priority = updates.priority;

    await ctx.db.patch(routineId, updateData);
    return routineId;
  },
});
