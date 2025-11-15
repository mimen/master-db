import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { Frequency } from "../types/frequency";
import { Duration } from "../types/duration";

export const createRoutine = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    frequency: v.union(
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
    ),
    duration: v.union(
      v.literal(Duration.FiveMin),
      v.literal(Duration.FifteenMin),
      v.literal(Duration.ThirtyMin),
      v.literal(Duration.FortyFiveMin),
      v.literal(Duration.OneHour),
      v.literal(Duration.TwoHours),
      v.literal(Duration.ThreeHours),
      v.literal(Duration.FourHours)
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
    priority: v.optional(v.number()), // 1-4, defaults to 1 (P4)
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const routineData = {
      name: args.name,
      description: args.description,
      category: args.category,
      frequency: args.frequency,
      duration: args.duration,
      timeOfDay: args.timeOfDay,
      idealDay: args.idealDay,
      todoistProjectId: args.todoistProjectId,
      todoistLabels: args.todoistLabels ?? [],
      priority: args.priority ?? 1, // Default to P4
      defer: false, // New routines start active
      deferralDate: undefined,
      lastCompletedDate: undefined,
      completionRateOverall: 100, // Start optimistic
      completionRateMonth: 100,
      createdAt: now,
      updatedAt: now,
    };

    const routineId = await ctx.db.insert("routines", routineData);
    return routineId;
  },
});
