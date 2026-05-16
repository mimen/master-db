import { defineSchema } from "convex/server";

// Service table definitions
import * as agentic from "./schema/agentic";
import * as routines from "./schema/routines";
import { sync_state } from "./schema/sync/syncState";
import * as todoist from "./schema/todoist";

// Sync management tables

export default defineSchema({
  // Todoist tables
  ...todoist,

  // Routines tables
  ...routines,

  // Agentic engine tables
  ...agentic,

  // Sync management
  sync_state,

  // Future integrations can add their tables here:
  // ...googleCalendar,
  // ...beeper,
  // etc.
});
