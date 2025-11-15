import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// Run incremental sync every 10 minutes
crons.interval(
  "todoist-incremental-sync",
  { minutes: 10 },
  internal.todoist.sync.performIncrementalSync
);

// Run daily routine task generation at midnight (00:00)
crons.daily(
  "daily-routine-generation",
  { hourUTC: 8, minuteUTC: 0 }, // 8am UTC = 12am PST
  internal.routines.crons.dailyRoutineGeneration
);

export default crons;