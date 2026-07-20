import { httpRouter } from "convex/server";

import { auth } from "./auth";
import {
  handleDiscover as handleBeeperAttachmentsDiscover,
  handleRecord as handleBeeperAttachmentsRecord,
  handleUploadUrl as handleBeeperAttachmentsUploadUrl,
} from "./beeper/sync/handleAttachments";
import { handleIngest as handleBeeperIngest } from "./beeper/sync/handleIngest";
import { handleTodoistWebhook } from "./todoist/webhook";

/**
 * HTTP Router for Convex
 * Handles incoming HTTP requests and routes them to appropriate handlers
 */
const http = httpRouter();

/**
 * Convex Auth — mounts /api/auth/* (Google OAuth callback, token refresh,
 * sign-out). These endpoints are intentionally public; the whitelist is
 * enforced in the Google provider's `profile()` callback.
 */
auth.addHttpRoutes(http);

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

/**
 * Beeper attachments — Phase B upload pipeline.
 *
 * /beeper/attachments/discover — body { mxc_ids: string[] } → which are already uploaded
 * /beeper/attachments/uploadUrl — body {} → short-lived signed PUT URL
 * /beeper/attachments/record   — body { mxc_id, convex_storage_id, ... } → register
 *
 * All three use the same Bearer-secret auth as /beeper/ingest. See
 * scripts/upload-beeper-attachments.ts in this repo for the client side.
 */
http.route({
  path: "/beeper/attachments/discover",
  method: "POST",
  handler: handleBeeperAttachmentsDiscover,
});
http.route({
  path: "/beeper/attachments/uploadUrl",
  method: "POST",
  handler: handleBeeperAttachmentsUploadUrl,
});
http.route({
  path: "/beeper/attachments/record",
  method: "POST",
  handler: handleBeeperAttachmentsRecord,
});

export default http;
