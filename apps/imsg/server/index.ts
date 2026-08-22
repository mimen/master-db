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

const fetchWithBranchManifest = withBranchManifest(app.fetch, Bun.env.COMMA_BRANCH_MANIFEST_PATH ?? null);

export default {
  hostname: config.hostname,
  port: config.port,
  idleTimeout: 120,
  fetch: fetchWithBranchManifest,
};
