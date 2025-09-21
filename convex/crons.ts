import { cronJobs } from "convex/server";

import { api } from "./_generated/api";

const crons = cronJobs();

// Run incremental sync every 5 minutes
crons.interval(
  "todoist-incremental-sync",
  { minutes: 10 },
  api.todoist.sync.performIncrementalSync
);

export default crons;