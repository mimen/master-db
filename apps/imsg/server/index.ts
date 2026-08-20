import { createApp } from "./app";
import { BlueBubblesClient } from "./bluebubbles";
import { loadConfig } from "./config";
import { OverlayDb } from "./db";

const config = loadConfig();
const bb = new BlueBubblesClient(config.bbUrl, config.bbPassword);
const db = new OverlayDb(config.dbPath);
const { app } = await createApp({ config, bb, db });

console.log(`imsg server on ${config.hostname}:${config.port}`);

export default {
  hostname: config.hostname,
  port: config.port,
  idleTimeout: 120,
  fetch: app.fetch,
};
