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

// Airtable Humans -> identity graph. Full refresh; the table's small enough
// that incremental sync isn't worth the complexity.
crons.interval(
  "airtable-humans-sync",
  { hours: 1 },
  internal.identity.airtableSync.syncAirtableHumans
);

// Beeper chats -> identity graph (cluster NEW Beeper participants into the
// identity/people tables). Daily, not hourly like Airtable: Beeper chats
// accrue slowly (new participants show up over days, not minutes), and the
// Apple Contacts and Airtable Humans paths already link cross-source
// continuously on their own faster schedules — this cron only exists to pick
// up Beeper-only participants those paths never see. Set semantics (see
// resolve.ts / internal.ts) make daily re-runs safe: each run recomputes
// chat_count from scratch rather than accumulating on top of the last run.
// 3am UTC, offset from airtable-humans-sync's top-of-hour firing.
crons.daily(
  "beeper-identity-resolve",
  { hourUTC: 3, minuteUTC: 15 },
  internal.identity.resolve.resolveIdentities
);

// Run daily routine task generation at midnight (00:00)
// crons.daily(
//   "daily-routine-generation",
//   { hourUTC: 8, minuteUTC: 0 }, // 8am UTC = 12am PST
//   internal.routines.crons.dailyRoutineGeneration
// );

export default crons;