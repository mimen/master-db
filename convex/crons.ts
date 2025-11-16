import { cronJobs } from "convex/server";

import { api, internal } from "./_generated/api";

const crons = cronJobs();

// NOTE: Crons temporarily disabled due to cloud validation issue with new directory structure
// TODO: Re-enable after investigating Convex cloud validation requirements
// Run incremental sync every 10 minutes
crons.interval(
  "todoist-sync-incremental",
  { minutes: 10 },
  internal.todoist.sync.performIncrementalSync.performIncrementalSync
);

// Run daily routine task generation at midnight (00:00)
// crons.daily(
//   "daily-routine-generation",
//   { hourUTC: 8, minuteUTC: 0 }, // 8am UTC = 12am PST
//   internal.routines.crons.dailyRoutineGeneration
// );

export default crons;