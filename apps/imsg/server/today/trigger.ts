import { todayWindow } from "../../shared/today";
import { ConvexIngest } from "../bridge/convex-ingest";
import { todayPort, type TodayPort } from "./build";

/**
 * The 7:00 AM job, run by launchd through hub/bin/run. It asks for the day's build if none exists,
 * waits for the worker in comma:server to finish it, and exits 0 for done or 1 for failed, so the
 * hub ledger shows a failed morning build.
 */
export async function awaitScheduledBuild(
  port: Pick<TodayPort, "post">,
  day: { day: string; dayStart: number },
  opts: { pollMs: number; timeoutMs: number; sleep?: (ms: number) => Promise<void>; now?: () => number; log?: (line: string) => void },
): Promise<"done" | "failed"> {
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.log(line));
  const deadline = now() + opts.timeoutMs;
  for (;;) {
    if (now() > deadline) {
      log(`today: ${day.day} still not built after ${Math.round(opts.timeoutMs / 60_000)} minutes`);
      return "failed";
    }
    try {
      const run = await port.post("todaySchedule", day);
      if (run.status === "done") return "done";
      if (run.status === "failed") {
        log(`today: ${day.day} failed: ${run.error}`);
        return "failed";
      }
    } catch (error) {
      log(`today: ${day.day} poll failed: ${String(error)}`);
    }
    await sleep(opts.pollMs);
  }
}

if (import.meta.main) {
  const { day, start } = todayWindow(Date.now());
  const ingest = new ConvexIngest({
    convexSiteUrl: Bun.env.CONVEX_SITE_URL?.replace(/\/$/, "") ?? null,
    commaBridgeSecret: Bun.env.COMMA_BRIDGE_SECRET?.trim() || null,
  });
  const outcome = await awaitScheduledBuild(todayPort(ingest), { day, dayStart: start }, { pollMs: 5_000, timeoutMs: 15 * 60_000 });
  console.log(`today: ${day} ${outcome}`);
  process.exit(outcome === "done" ? 0 : 1);
}
