import { loadConfig } from "../server/config";
import { runBackfill } from "../server/bridge/backfill";

if (import.meta.main) {
  try {
    const result = await runBackfill({
      config: loadConfig(),
      checkpointPath: Bun.env.COMMA_BACKFILL_CHECKPOINT,
    });
    if (result) console.log(`Comma backfill complete ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`Comma backfill failed. ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
