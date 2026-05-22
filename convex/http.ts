import { httpRouter } from "convex/server";

import { handleIngest as handleBeeperIngest } from "./beeper/sync/handleIngest";
import { handleTodoistWebhook } from "./todoist/webhook";

/**
 * HTTP Router for Convex
 * Handles incoming HTTP requests and routes them to appropriate handlers
 */
const http = httpRouter();

/**
 * Todoist webhook endpoint
 * POST /todoist/webhook
 *
 * Receives real-time webhook notifications from Todoist
 * Documentation: https://developer.todoist.com/api/v1#tag/Webhooks
 *
 * Required headers:
 * - X-Todoist-Hmac-SHA256: HMAC signature for verification
 * - X-Todoist-Delivery-ID: Unique delivery identifier
 *
 * Configuration:
 * 1. Set TODOIST_WEBHOOK_SECRET in environment variables
 * 2. Configure webhook URL in Todoist App Management Console:
 *    https://your-convex-deployment.convex.cloud/todoist/webhook
 */
http.route({
  path: "/todoist/webhook",
  method: "POST",
  handler: handleTodoistWebhook,
});

/**
 * Beeper ingest endpoint
 * POST /beeper/ingest
 *
 * Receives batched accounts/chats/messages from the local Beeper sync script.
 * Auth: Bearer token matching the BEEPER_INGEST_SECRET env var on this
 * deployment (same value as the local script's $BEEPER_INGEST_SECRET).
 *
 * See convex/beeper/README.md for the payload shape and the local script at
 * scripts/sync-beeper.ts in this repo.
 */
http.route({
  path: "/beeper/ingest",
  method: "POST",
  handler: handleBeeperIngest,
});

export default http;
