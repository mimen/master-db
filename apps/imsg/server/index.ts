import { createApp } from "./app";
import { withBranchManifest } from "./branch-manifest";
import { BlueBubblesClient } from "./bluebubbles";
import { loadConfig } from "./config";
import { OverlayDb } from "./db";

const config = loadConfig();
const bb = new BlueBubblesClient(config.bbUrl, config.bbPassword);
const db = new OverlayDb(config.dbPath);
const { app } = await createApp({ config, bb, db });

console.log(`imsg server on ${config.hostname}:${config.port}`);

// A blocked event loop delays every request at once, so report it when it happens.
const LAG_TICK_MS = 500;
const LAG_REPORT_MS = 200;
let expectedTick = performance.now() + LAG_TICK_MS;
setInterval(() => {
  const lag = performance.now() - expectedTick;
  if (lag > LAG_REPORT_MS) console.warn(`event loop lag ${Math.round(lag)}ms`);
  expectedTick = performance.now() + LAG_TICK_MS;
}, LAG_TICK_MS).unref();

const fetchWithBranchManifest = withBranchManifest(app.fetch, Bun.env.COMMA_BRANCH_MANIFEST_PATH ?? null);

export default {
  hostname: config.hostname,
  port: config.port,
  idleTimeout: 120,
  development: false,
  fetch: fetchWithBranchManifest,
};
